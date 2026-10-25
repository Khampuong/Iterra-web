// คำนวณราคา ระยะเวลา และความเป็นไปได้ + ตัววิเคราะห์สำรองเมื่อไม่ได้ต่อ Claude API
import { q, today, businessDaysBetween, getSettings } from './db.js';
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
  // อัตราค่าแรงเป็นบาท/ชั่วโมง: ต้นทุน = man-day × ชั่วโมงต่อวัน × อัตรา
  const hours = Number(settings.capacity.hours_per_day) > 0 ? Number(settings.capacity.hours_per_day) : 8;
  let days = 0;
  let cost = 0;
  for (const [code, d] of Object.entries(effort)) {
    days += d;
    cost += d * hours * (settings.rates[code] ?? 0);
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
    note: analysis?.dev_review
      ? `dev ${analysis.dev_review.by} ปรับจาก ${analysis.dev_review.before} เป็น ${analysis.dev_review.score}${analysis.dev_review.note ? ` — ${analysis.dev_review.note}` : ''}`
      : analysis ? 'จากผลวิเคราะห์ Requirement' : 'ยังไม่ได้วิเคราะห์ ใช้ค่ากลาง',
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
const BUILTIN_OPTIONS = CATALOG.map((m) => ({ id: m.id, title: m.title, desc: m.desc }));

// เช็คลิสต์ทั้งหมด = รายการมาตรฐานของระบบ + รายการที่ admin เพิ่มเองในหน้าตั้งค่า
export function requirementOptions(settings = getSettings()) {
  return [...BUILTIN_OPTIONS, ...settings.requirement_items.map((m) => ({ ...m, custom: true }))];
}

export function parseChecks(deal) {
  try {
    const v = JSON.parse(deal.requirement_checks || '[]');
    const known = requirementOptions().map((o) => o.id);
    return Array.isArray(v) ? v.filter((id) => known.includes(id)) : [];
  } catch {
    return [];
  }
}

// ส่วนเสริมที่เลื่อนไปเฟส 2 ได้ก่อนเมื่อเกินงบ
const OPTIONAL_MODULES = ['service', 'chat', 'notify', 'dashboard', 'mobile'];

const RISK_WORDS = [
  [/ai|machine learning|ปัญญาประดิษฐ์|blockchain|เรียลไทม์|real-?time/i, 'มีส่วนที่ใช้เทคโนโลยีเฉพาะทาง ควรทำ Proof of Concept ก่อนยืนยันราคา'],
  [/ด่วน|เร่ง|ภายในสัปดาห์|asap/i, 'ลูกค้าต้องการงานเร่งด่วน ควรตกลงขอบเขตงานงวดแรกให้ชัด'],
  [/ย้ายข้อมูล|migrat|ระบบเดิม|legacy/i, 'ต้องย้ายข้อมูล/เชื่อมกับระบบเดิม ควรขอดูตัวอย่างข้อมูลจริงก่อน'],
];

export function fallbackAnalyze(deal) {
  const text = `${deal.title}\n${deal.project_type || ''}\n${deal.requirement}`;
  const checks = parseChecks(deal);
  // ลูกค้าติ๊กเอง = should, จับได้จากคำสำคัญอย่างเดียว/บริการเสริม = could (เลื่อนไปเฟส 2 ได้ก่อนเมื่อเกินงบ)
  let modules = CATALOG.filter((m) => checks.includes(m.id) || m.k.test(text)).map(({ id, title, desc, effort }) => ({
    title, description: desc, effort: { ...effort },
    priority: checks.includes(id) && !OPTIONAL_MODULES.includes(id) ? 'should' : 'could',
  }));
  // รายการที่ admin เพิ่มเอง: ใช้เมื่อถูกติ๊กเท่านั้น (ไม่มีการจับคำสำคัญ)
  for (const m of getSettings().requirement_items) {
    if (checks.includes(m.id)) modules.push({ title: m.title, description: m.desc, effort: { ...m.effort }, priority: 'should' });
  }

  if (modules.length === 0) {
    // ไม่พบคำสำคัญ: ใช้แต่ละบรรทัดของ requirement เป็นรายการงาน
    modules = deal.requirement
      .split(/\r?\n/).map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter((l) => l.length > 3).slice(0, 12)
      .map((l) => ({ title: l.slice(0, 80), description: l, effort: { FE: 2, BE: 3, QA: 1 }, priority: 'should' }));
  }
  if (modules.length === 0) {
    modules = [{ title: deal.title, description: 'ขอบเขตงานตามที่ตกลงกับลูกค้า', effort: { FE: 3, BE: 4, QA: 1 }, priority: 'must' }];
  }

  const dev = modules.reduce((s, m) => s + Object.values(m.effort).reduce((a, b) => a + b, 0), 0);
  const scale = (ratio, min) => Math.max(min, Math.round(dev * ratio * 2) / 2);
  const items = [
    { title: 'เก็บ Requirement และวางแผนโครงการ', description: 'สัมภาษณ์ผู้ใช้ สรุปขอบเขต แผนงาน และเกณฑ์ตรวจรับ', effort: { PM: scale(0.06, 1), BA: scale(0.08, 1) }, priority: 'must' },
    { title: 'วิเคราะห์และออกแบบระบบ', description: 'ออกแบบขั้นตอนทำงาน โครงสร้างข้อมูล และสถาปัตยกรรม', effort: { SA: scale(0.08, 1), ARCH: scale(0.03, 0.5) }, priority: 'must' },
    ...modules,
    { title: 'ทดสอบระบบและ UAT', description: 'ทดสอบรวม Regression และช่วยผู้ใช้ตรวจรับ', effort: { QA: scale(0.08, 1), PM: scale(0.02, 0.5) }, priority: 'must' },
    { title: 'นำขึ้นใช้งานและส่งมอบ', description: 'เตรียม Environment นำขึ้นระบบจริง อบรมการใช้งาน และรับประกัน', effort: { DEVOPS: scale(0.04, 1), SUPPORT: scale(0.03, 1) }, priority: 'must' },
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

// ---------- ปรับขอบเขตให้พอดีงบลูกค้า ----------
// priority ของรายการ: must = ต้องมี (ตัดไม่ได้), should = สำคัญ, could = เลื่อนไปเฟส 2 ได้ก่อน
const PRIORITY_RANK = { could: 0, should: 1, must: 2 };
const MAX_TRIM = 0.2; // ลดกำลังคนได้ไม่เกิน 20% ต่อรายการ (ทำแบบกระชับ เช่น ใช้ดีไซน์มาตรฐาน ลดรอบแก้ไข)

const netOf = (items, settings) => dealTotals(items.map((i) => priceItem(i, settings)), { discount: 0 }, settings).net;

function trimItems(items, factor) {
  return items.map((it) => ({
    ...it,
    effort: Object.fromEntries(Object.entries(it.effort).map(([c, d]) => [c, d <= 0.5 ? d : Math.max(0.5, Math.round(d * factor * 2) / 2)])),
  }));
}

// ลดขอบเขตจนราคาก่อน VAT ไม่เกินงบ: เลื่อนรายการที่สำคัญน้อยไปเฟส 2 ก่อน แล้วค่อยลดกำลังคนส่วนที่เหลือ
// ราคายังคำนวณจากอัตราค่าแรง + กำไรตามตั้งค่า จึงไม่ต่ำกว่าต้นทุน
export function fitToBudget(items, budget, settings) {
  const original = netOf(items, settings);
  if (!(budget > 0)) return { items, fit: null };
  const base = { budget, original_net: original };
  if (original <= budget) return { items, fit: { ...base, status: 'within', fitted_net: original, trim_percent: 0, deferred: [] } };

  let keep = items.map((it, n) => ({ ...it, _n: n }));
  const deferred = [];
  const minNet = (list) => netOf(trimItems(list, 1 - MAX_TRIM), settings);
  // เลื่อนรายการไปเฟส 2 จนกว่าการลดกำลังคนจะพอปิดส่วนต่างได้
  while (minNet(keep) > budget) {
    const pool = keep.filter((it) => (it.priority ?? 'should') !== 'must');
    if (!pool.length) break;
    const rank = Math.min(...pool.map((it) => PRIORITY_RANK[it.priority ?? 'should']));
    const tier = pool.filter((it) => PRIORITY_RANK[it.priority ?? 'should'] === rank);
    const gap = minNet(keep) - budget;
    const price = (it) => priceItem(it, settings).price;
    // ในกลุ่มเดียวกัน: เลือกรายการเล็กสุดที่ตัดแล้วพอดีงบ ถ้าไม่มีให้ตัดรายการใหญ่สุด
    const enough = tier.filter((it) => price(it) * (1 - MAX_TRIM) >= gap).sort((a, b) => price(a) - price(b));
    const pick = enough[0] ?? tier.sort((a, b) => price(b) - price(a))[0];
    keep = keep.filter((it) => it !== pick);
    deferred.push(pick);
  }
  // ตัดเกินไป: เติมรายการที่เลื่อนไว้กลับเข้าขอบเขต (สำคัญก่อน) ถ้ายังพอดีงบ
  for (const it of [...deferred].sort((a, b) => PRIORITY_RANK[b.priority ?? 'should'] - PRIORITY_RANK[a.priority ?? 'should'] || a._n - b._n)) {
    const next = [...keep, it].sort((a, b) => a._n - b._n);
    if (minNet(next) <= budget) { keep = next; deferred.splice(deferred.indexOf(it), 1); }
  }
  // ลดกำลังคนเท่าที่จำเป็น (ทีละ 1%) ไม่เกิน MAX_TRIM
  let factor = 1;
  let fitted = keep;
  while (netOf(fitted, settings) > budget && factor > 1 - MAX_TRIM + 1e-9) {
    factor = Math.round((factor - 0.01) * 100) / 100;
    fitted = trimItems(keep, factor);
  }
  const fittedNet = netOf(fitted, settings);
  const clean = ({ _n, ...it }) => it;
  return {
    items: fitted.map(clean),
    fit: {
      ...base,
      status: fittedNet <= budget ? 'fitted' : 'over',
      fitted_net: fittedNet,
      trim_percent: Math.round((1 - factor) * 100),
      deferred: deferred.sort((a, b) => a._n - b._n).map((it) => ({ ...clean(it), price: priceItem(it, settings).price })),
    },
  };
}
