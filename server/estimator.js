// คำนวณราคา ระยะเวลา และความเป็นไปได้ + ตัววิเคราะห์สำรองเมื่อไม่ได้ต่อ Claude API
import { q, today, businessDaysBetween } from './db.js';
import { POSITION_CODES, positionByCode } from './positions.js';

const round100 = (n) => Math.round(n / 100) * 100;

export function cleanEffort(effort) {
  const out = {};
  for (const [code, days] of Object.entries(effort || {})) {
    const d = Number(days);
    if (POSITION_CODES.includes(code) && d > 0) out[code] = Math.round(d * 2) / 2;
  }
  return out;
}

export function priceItem(item, settings) {
  const effort = typeof item.effort === 'string' ? JSON.parse(item.effort) : item.effort || {};
  let days = 0;
  let cost = 0;
  for (const [code, d] of Object.entries(effort)) {
    days += d;
    cost += d * (settings.rates[code] ?? 0);
  }
  const computed = round100(cost * (1 + settings.pricing.margin_percent / 100));
  const price = item.price_override != null ? Number(item.price_override) : computed;
  return { ...item, effort, days, cost, computed_price: computed, price };
}

export function dealTotals(items, deal, settings) {
  const subtotal = items.reduce((s, i) => s + i.price, 0);
  const cost = items.reduce((s, i) => s + i.cost, 0);
  const days = items.reduce((s, i) => s + i.days, 0);
  const discount = Math.min(Number(deal.discount) || 0, subtotal);
  const net = subtotal - discount;
  const vat = Math.round(net * settings.pricing.vat_percent) / 100;
  return { subtotal, discount, net, vat, vat_percent: settings.pricing.vat_percent, total: net + vat, cost, days };
}

export function effortByPosition(items) {
  const out = {};
  for (const it of items) for (const [code, d] of Object.entries(it.effort)) out[code] = (out[code] || 0) + d;
  return out;
}

// ระยะเวลา (วันทำการ) = man-day รวม / จำนวนคนที่ทำงานขนานกัน + เผื่อ buffer
export function suggestDuration(totalDays, settings) {
  const { parallel_people, buffer_percent } = settings.capacity;
  return Math.max(5, Math.ceil((totalDays / Math.max(1, parallel_people)) * (1 + buffer_percent / 100)));
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

export function feasibility(deal, totals, settings) {
  const analysis = deal.analysis ? JSON.parse(deal.analysis) : null;
  const factors = [];

  const tech = clamp(analysis?.technical_score ?? 70);
  factors.push({
    key: 'technical', label: 'ความเป็นไปได้ทางเทคนิค', weight: 40, score: tech,
    note: analysis ? 'จากผลวิเคราะห์ Requirement' : 'ยังไม่ได้วิเคราะห์ ใช้ค่ากลาง',
  });

  if (deal.deadline && deal.duration_days > 0) {
    const available = businessDaysBetween(today(), deal.deadline);
    const score = clamp((available / deal.duration_days) * 100 - (available < deal.duration_days ? 20 : 0));
    factors.push({
      key: 'time', label: 'ระยะเวลา', weight: 25, score,
      note: `ต้องใช้ ${deal.duration_days} วันทำการ ลูกค้าให้เวลา ${available} วันทำการ`,
    });
  } else {
    factors.push({ key: 'time', label: 'ระยะเวลา', weight: 25, score: 80, note: 'ลูกค้ายังไม่กำหนดวันส่งมอบ' });
  }

  if (deal.budget > 0 && totals.net > 0) {
    const ratio = deal.budget / totals.net;
    factors.push({
      key: 'budget', label: 'งบประมาณลูกค้า', weight: 20, score: clamp(ratio * 100 - (ratio < 1 ? 15 : 0)),
      note: `งบลูกค้าคิดเป็น ${Math.round(ratio * 100)}% ของราคาเสนอ (ก่อน VAT)`,
    });
  } else {
    factors.push({ key: 'budget', label: 'งบประมาณลูกค้า', weight: 20, score: 75, note: 'ลูกค้ายังไม่แจ้งงบประมาณ' });
  }

  const active = q.get("SELECT COUNT(*) AS n FROM projects WHERE status = 'active'").n;
  const max = Math.max(1, settings.capacity.max_active_projects);
  factors.push({
    key: 'capacity', label: 'กำลังคนของทีม', weight: 15, score: clamp(100 - (active / max) * 70),
    note: `มีโครงการที่กำลังทำ ${active} จากที่รับได้พร้อมกัน ${max} โครงการ`,
  });

  const score = clamp(factors.reduce((s, f) => s + f.score * f.weight, 0) / 100);
  const hardFail = factors.some((f) => f.score < 35);
  const level = score >= 75 && !hardFail ? 'go' : score >= 50 ? 'conditional' : 'no-go';
  const label = { go: 'รับงานได้', conditional: 'รับได้แบบมีเงื่อนไข', 'no-go': 'ไม่แนะนำให้รับ' }[level];
  return { score, level, label, factors };
}

// ---------- ตัววิเคราะห์สำรอง (rule-based) ----------
const CATALOG = [
  { k: /login|ล็อกอิน|เข้าสู่ระบบ|สมาชิก|สมัคร|ผู้ใช้|สิทธิ์|role/i, title: 'ระบบสมาชิกและสิทธิ์การใช้งาน', desc: 'สมัคร/เข้าสู่ระบบ จัดการผู้ใช้และกำหนดสิทธิ์ตามบทบาท', effort: { UX: 1, FE: 2, BE: 3, QA: 1 } },
  { k: /dashboard|แดชบอร์ด|รายงาน|report|กราฟ|สรุปผล|สถิติ/i, title: 'Dashboard และรายงาน', desc: 'หน้าสรุปภาพรวม กราฟ และรายงานส่งออกได้', effort: { UX: 2, FE: 4, BE: 3, QA: 1 } },
  { k: /ชำระ|จ่ายเงิน|payment|qr|พร้อมเพย์|บัตรเครดิต/i, title: 'ระบบชำระเงินออนไลน์', desc: 'เชื่อมต่อ Payment Gateway ตรวจสอบสถานะและออกหลักฐานการชำระ', effort: { SA: 1, BE: 5, FE: 2, QA: 2, SEC: 1 } },
  { k: /สินค้า|ตะกร้า|สั่งซื้อ|ร้านค้า|e-?commerce|shop|ออเดอร์|order/i, title: 'ระบบสินค้าและคำสั่งซื้อ', desc: 'แคตตาล็อกสินค้า ตะกร้า คำสั่งซื้อ และติดตามสถานะ', effort: { UX: 3, FE: 6, BE: 6, QA: 3 } },
  { k: /จอง|booking|นัดหมาย|คิว|ปฏิทิน/i, title: 'ระบบจองและนัดหมาย', desc: 'ปฏิทินเวลาว่าง การจอง ยืนยัน และเลื่อน/ยกเลิก', effort: { UX: 2, FE: 4, BE: 5, QA: 2 } },
  { k: /สต็อก|คลัง|stock|inventory|erp|จัดซื้อ|บัญชี/i, title: 'ระบบคลังสินค้า/ERP', desc: 'รับ-จ่ายสินค้า ยอดคงเหลือ และเอกสารที่เกี่ยวข้อง', effort: { BA: 3, SA: 3, FE: 6, BE: 8, DBA: 2, QA: 4 } },
  { k: /ใบเสนอราคา|ใบแจ้งหนี้|ใบเสร็จ|เอกสาร|pdf|สัญญา/i, title: 'ระบบเอกสารและการพิมพ์', desc: 'สร้างเอกสารตามแบบฟอร์ม เลขรันอัตโนมัติ และพิมพ์/ส่งออก PDF', effort: { SA: 1, FE: 3, BE: 3, QA: 1 } },
  { k: /แจ้งเตือน|notification|line|อีเมล|email|sms/i, title: 'ระบบแจ้งเตือน', desc: 'แจ้งเตือนในระบบและช่องทางภายนอกตามเหตุการณ์', effort: { BE: 3, FE: 1, QA: 1 } },
  { k: /แชท|chat|ข้อความ|สนทนา/i, title: 'ระบบแชท/ข้อความ', desc: 'สนทนาแบบเรียลไทม์ระหว่างผู้ใช้', effort: { FE: 4, BE: 5, QA: 2 } },
  { k: /มือถือ|mobile|ios|android|แอป/i, title: 'แอปพลิเคชันมือถือ', desc: 'แอป iOS / Android เชื่อมต่อกับบริการหลังบ้าน', effort: { UX: 4, MOBILE: 15, BE: 4, QA: 4 } },
  { k: /api|เชื่อมต่อ|integrat|webhook|ระบบอื่น/i, title: 'การเชื่อมต่อระบบภายนอก (API)', desc: 'ออกแบบและพัฒนา API / Integration กับระบบอื่น', effort: { SA: 2, BE: 5, QA: 2 } },
  { k: /อบรม|คอร์ส|course|เรียน|training|e-?learning|แบบทดสอบ/i, title: 'ระบบอบรม/คอร์สเรียน', desc: 'จัดการหลักสูตร ผู้เรียน เนื้อหา และผลการเรียน', effort: { UX: 3, FE: 6, BE: 6, QA: 3 } },
  { k: /บทความ|blog|ข่าว|cms|เนื้อหา|หน้าเว็บ|landing|เว็บไซต์/i, title: 'เว็บไซต์และระบบจัดการเนื้อหา', desc: 'หน้าเว็บหลัก บทความ และหลังบ้านสำหรับแก้ไขเนื้อหา', effort: { UX: 3, FE: 5, BE: 3, QA: 1 } },
  { k: /admin|หลังบ้าน|แอดมิน|จัดการข้อมูล/i, title: 'ระบบหลังบ้านสำหรับผู้ดูแล', desc: 'จัดการข้อมูลหลัก ค้นหา กรอง และแก้ไขรายการ', effort: { UX: 1, FE: 4, BE: 4, QA: 2 } },
  // บริการเสริม: ราคาเป็นค่าดำเนินการ ไม่รวมค่าเช่า Server / ค่าจดโดเมนที่จ่ายให้ผู้ให้บริการ
  { k: /hosting|โฮสติ้ง|เช่า ?server|ขึ้น ?server|cloud/i, title: 'ขึ้น Server', desc: 'จัดเตรียม Server / Cloud ติดตั้งระบบ ตั้งค่าความปลอดภัยและสำรองข้อมูล (ไม่รวมค่าเช่า Server)', effort: { DEVOPS: 2, INFRA: 1.5 } },
  { k: /domain|โดเมน|ssl/i, title: 'จด Domain', desc: 'จดทะเบียนโดเมน ตั้งค่า DNS และใบรับรอง SSL (ไม่รวมค่าจดโดเมนรายปี)', effort: { DEVOPS: 0.5 } },
  { k: /service|ดูแลระบบ|บำรุงรักษา|maintenance|\bma\b/i, title: 'Service ดูแลระบบหลังส่งมอบ', desc: 'ดูแล แก้ไขปัญหา อัปเดตระบบ และตอบคำถามการใช้งานหลังส่งมอบ', effort: { SUPPORT: 5, BE: 1 } },
];

// รหัสของแต่ละรายการในเช็คลิสต์ Requirement (เรียงตาม CATALOG)
const CATALOG_IDS = ['member', 'dashboard', 'payment', 'shop', 'booking', 'erp', 'docs', 'notify', 'chat', 'mobile', 'api', 'training', 'cms', 'admin', 'hosting', 'domain', 'service'];
CATALOG.forEach((m, i) => { m.id = CATALOG_IDS[i]; });
export const REQUIREMENT_OPTIONS = CATALOG.map((m) => ({ id: m.id, title: m.title, desc: m.desc }));

export function parseChecks(deal) {
  try {
    const v = JSON.parse(deal.requirement_checks || '[]');
    return Array.isArray(v) ? v.filter((id) => CATALOG_IDS.includes(id)) : [];
  } catch {
    return [];
  }
}

const RISK_WORDS = [
  [/ai|machine learning|ปัญญาประดิษฐ์|blockchain|เรียลไทม์|real-?time/i, 'มีส่วนที่ใช้เทคโนโลยีเฉพาะทาง ควรทำ Proof of Concept ก่อนยืนยันราคา'],
  [/ด่วน|เร่ง|ภายในสัปดาห์|asap/i, 'ลูกค้าต้องการงานเร่งด่วน ควรตกลงขอบเขตงานงวดแรกให้ชัด'],
  [/ย้ายข้อมูล|migrat|ระบบเดิม|legacy/i, 'ต้องย้ายข้อมูล/เชื่อมกับระบบเดิม ควรขอดูตัวอย่างข้อมูลจริงก่อน'],
];

export function fallbackAnalyze(deal) {
  const text = `${deal.title}\n${deal.project_type || ''}\n${deal.requirement}`;
  const checks = parseChecks(deal);
  let modules = CATALOG.filter((m) => checks.includes(m.id) || m.k.test(text)).map(({ title, desc, effort }) => ({
    title, description: desc, effort: { ...effort },
  }));

  if (modules.length === 0) {
    // ไม่พบคำสำคัญ: ใช้แต่ละบรรทัดของ requirement เป็นรายการงาน
    modules = deal.requirement
      .split(/\r?\n/).map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter((l) => l.length > 3).slice(0, 12)
      .map((l) => ({ title: l.slice(0, 80), description: l, effort: { FE: 2, BE: 3, QA: 1 } }));
  }
  if (modules.length === 0) {
    modules = [{ title: deal.title, description: 'ขอบเขตงานตามที่ตกลงกับลูกค้า', effort: { FE: 3, BE: 4, QA: 1 } }];
  }

  const dev = modules.reduce((s, m) => s + Object.values(m.effort).reduce((a, b) => a + b, 0), 0);
  const scale = (ratio, min) => Math.max(min, Math.round(dev * ratio * 2) / 2);
  const items = [
    { title: 'เก็บ Requirement และวางแผนโครงการ', description: 'สัมภาษณ์ผู้ใช้ สรุปขอบเขต แผนงาน และเกณฑ์ตรวจรับ', effort: { PM: scale(0.06, 1), BA: scale(0.08, 1) } },
    { title: 'วิเคราะห์และออกแบบระบบ', description: 'ออกแบบขั้นตอนทำงาน โครงสร้างข้อมูล และสถาปัตยกรรม', effort: { SA: scale(0.08, 1), ARCH: scale(0.03, 0.5) } },
    ...modules,
    { title: 'ทดสอบระบบและ UAT', description: 'ทดสอบรวม Regression และช่วยผู้ใช้ตรวจรับ', effort: { QA: scale(0.08, 1), PM: scale(0.02, 0.5) } },
    { title: 'นำขึ้นใช้งานและส่งมอบ', description: 'เตรียม Environment นำขึ้นระบบจริง อบรมการใช้งาน และรับประกัน', effort: { DEVOPS: scale(0.04, 1), SUPPORT: scale(0.03, 1) } },
  ];

  const risks = RISK_WORDS.filter(([re]) => re.test(text)).map(([, msg]) => msg);
  if (deal.requirement.trim().length < 120 && checks.length < 3) risks.push('Requirement ยังสั้นมาก ควรเก็บรายละเอียดเพิ่มก่อนยืนยันราคา');

  return {
    source: 'fallback',
    summary: `ประเมินเบื้องต้นจากเช็คลิสต์และคำสำคัญใน Requirement พบ ${modules.length} ส่วนงานหลัก`,
    technical_score: Math.max(40, 80 - risks.length * 10),
    risks,
    assumptions: ['ลูกค้าเป็นผู้จัดเตรียมเนื้อหาและข้อมูลตั้งต้น', 'ราคาไม่รวมค่า Server / Domain / บริการภายนอก'],
    questions: ['จำนวนผู้ใช้งานโดยประมาณ', 'มีระบบเดิมที่ต้องเชื่อมต่อหรือย้ายข้อมูลหรือไม่'],
    items,
  };
}

export { positionByCode };
