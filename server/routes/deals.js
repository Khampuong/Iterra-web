import { Router } from 'express';
import crypto from 'node:crypto';
import { q, tx, getSettings, nextCode, today, addDays, addBusinessDays, notify, SYSTEM_STEPS } from '../db.js';
import { hashPassword, PROJECT_ROLES, requireRole, seesAll, SELL_ROLES, WIDE_ROLES } from '../auth.js';
import { priceItem, dealTotals, feasibility, suggestDuration, cleanEffort, fallbackAnalyze, fitToBudget, parseChecks, requirementOptions } from '../estimator.js';
import { fallbackDemo } from '../demo-template.js';
import { cleanHttpUrl } from '../url.js';
import { analyzeRequirement, generateDemo, AiUnavailable } from '../ai.js';
import { createProjectFromDeal } from './projects.js';

const router = Router();
const sales = requireRole(...SELL_ROLES); // ขายงานได้
const view = requireRole(...SELL_ROLES, ...WIDE_ROLES); // ดูงานขายได้
const admin = requireRole('admin');
// บันทึกข้อมูลลูกค้า/งบประมาณ และวิเคราะห์ Requirement: คนขายงาน + ผู้ถือหุ้น
const editors = requireRole(...SELL_ROLES, 'shareholder');

const FIELDS = [
  'title', 'customer_name', 'customer_company', 'customer_email', 'customer_phone',
  'customer_tax_id', 'customer_address', 'project_type', 'budget', 'deadline', 'requirement', 'requirement_checks', 'quote_note',
];
const CLOSED = ['won', 'lost'];

// เบอร์โทรศัพท์ลูกค้า: เก็บเฉพาะตัวเลข ไม่เกิน 10 หลัก (คืน false ถ้าเกิน)
function normalizePhone(b) {
  if (b.customer_phone == null || b.customer_phone === '') return true;
  const digits = String(b.customer_phone).replace(/\D/g, '');
  if (digits.length > 10) return false;
  b.customer_phone = digits;
  return true;
}

// เช็คลิสต์ Requirement: เก็บเป็น JSON เฉพาะรหัสที่มีในระบบ
function normalizeChecks(b) {
  if (!('requirement_checks' in b)) return;
  const known = requirementOptions().map((o) => o.id);
  const list = Array.isArray(b.requirement_checks) ? b.requirement_checks.filter((id) => known.includes(id)) : [];
  b.requirement_checks = JSON.stringify([...new Set(list)]);
}

// หาพนักงานขายของงานจากชื่อ/อีเมลที่กรอกในฟอร์มงานขายใหม่
// ตรงกับสมาชิกที่มีอยู่ -> ใช้สมาชิกคนนั้น · ไม่ตรง -> เพิ่มสมาชิกใหม่เป็นพนักงานขาย (role sales)
function resolveSalesperson(input, currentUser) {
  const name = String(input?.name || '').trim();
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!name && !email) return { id: currentUser.id };

  const found = (email && q.get('SELECT * FROM users WHERE email = ?', email))
    || (name && q.get('SELECT * FROM users WHERE lower(trim(name)) = ? ORDER BY active DESC, id LIMIT 1', name.toLowerCase()));
  if (found) {
    if (!found.active) return { error: `สมาชิก “${found.name}” ถูกปิดการใช้งาน` };
    if (!SELL_ROLES.includes(found.role)) return { error: `สมาชิก “${found.name}” ไม่มีสิทธิ์ขายงาน` };
    return { id: found.id, name: found.name };
  }

  if (!name) return { error: 'กรุณากรอกชื่อพนักงานขาย' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: `ไม่พบ “${name}” ในสมาชิก กรุณากรอกอีเมลเพื่อเพิ่มเป็นพนักงานขาย` };
  // ใช้รหัสผ่านที่กรอกมา ถ้าเว้นว่างจะสุ่มรหัสชั่วคราวให้
  if (password && password.length < 8) return { error: 'รหัสผ่านพนักงานขายต้องยาวอย่างน้อย 8 ตัวอักษร' };
  const tempPassword = password ? null : crypto.randomBytes(6).toString('base64url');
  const r = q.run(
    "INSERT INTO users (name, email, password_hash, role, position) VALUES (?, ?, ?, 'sales', 'SALE')",
    name, email, hashPassword(password || tempPassword),
  );
  return { id: Number(r.lastInsertRowid), name, email, created: true, temp_password: tempPassword };
}

// ขั้นตอนปัจจุบันของงานขาย = ตำแหน่งที่ไกลกว่าระหว่างสถานะของระบบกับขั้นตอนที่เลือกเอง
function currentStep(deal, steps) {
  if (deal.status === 'lost') return null;
  if (deal.status === 'won') return 'won';
  const at = (id) => steps.findIndex((s) => s.id === id);
  return steps[Math.max(at(deal.status), at(deal.step), 0)].id;
}

// เพดานส่วนลดของพนักงานขาย: ราคาก่อน VAT ต้องไม่ต่ำกว่า ราคาตั้งต้น × (100 − เพดาน)%
// ราคาตั้งต้น = ราคาจากการวิเคราะห์ หรือราคาล่าสุดที่ admin/ผู้ถือหุ้นกำหนด (งานเก่าที่ยังไม่มี ใช้ราคาคำนวณจากรายการ)
export const isPriceAuthority = (user) => ['admin', 'shareholder'].includes(user.role);
function priceLimit(deal, settings) {
  const pct = Number(settings.pricing.max_sales_discount_percent) || 0;
  const base = deal.price_base ?? dealTotals(pricedItems(deal.id, settings), { discount: 0 }, settings).net;
  return { price_base: base, price_min: Math.ceil(base * (100 - pct)) / 100, max_sales_discount_percent: pct };
}

function adminIds() {
  return q.all("SELECT id FROM users WHERE role = 'admin' AND active = 1").map((u) => u.id);
}

function canSee(user, deal) {
  return seesAll(user) || deal.sales_id === user.id;
}

function findDeal(req, res) {
  const deal = q.get('SELECT * FROM deals WHERE id = ?', req.params.id);
  if (!deal) return res.status(404).json({ error: 'ไม่พบงานขายนี้' }) && null;
  if (!canSee(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูงานขายนี้' }) && null;
  return deal;
}

function pricedItems(dealId, settings) {
  return q.all('SELECT * FROM deal_items WHERE deal_id = ? ORDER BY sort, id', dealId).map((i) => priceItem(i, settings));
}

export function loadDeal(deal, { withDemo = true } = {}) {
  const settings = getSettings();
  const items = pricedItems(deal.id, settings);
  const totals = dealTotals(items, deal, settings);
  const { demo_html, analysis, ...rest } = deal;
  return {
    ...rest,
    analysis: analysis ? JSON.parse(analysis) : null,
    requirement_checks: parseChecks(deal),
    step: currentStep(deal, settings.sales_steps),
    ...priceLimit(deal, settings),
    dev_name: deal.dev_id ? q.get('SELECT name FROM users WHERE id = ?', deal.dev_id)?.name ?? null : null,
    has_demo: Boolean(demo_html),
    ...(withDemo ? { demo_html } : {}),
    items,
    totals,
    feasibility: feasibility(deal, totals, settings),
    sales_name: q.get('SELECT name FROM users WHERE id = ?', deal.sales_id)?.name ?? null,
    documents: q.all(
      'SELECT id, type, number, issued_at, due_at, amount, status, ref_id FROM documents WHERE deal_id = ? ORDER BY id',
      deal.id,
    ),
    project: q.get('SELECT id, code, status FROM projects WHERE deal_id = ?', deal.id) ?? null,
  };
}

function replaceItems(dealId, items) {
  q.run('DELETE FROM deal_items WHERE deal_id = ?', dealId);
  items.forEach((it, i) => {
    const override = it.price_override === '' || it.price_override == null ? null : Number(it.price_override);
    q.run(
      'INSERT INTO deal_items (deal_id, sort, title, description, effort, price_override) VALUES (?, ?, ?, ?, ?, ?)',
      dealId, i, String(it.title || 'รายการ').slice(0, 200), String(it.description || ''),
      JSON.stringify(cleanEffort(it.effort)), Number.isFinite(override) ? override : null,
    );
  });
}

// รายการที่เลื่อนไปเฟส 2 ตอนปรับขอบเขตให้พอดีงบ (ที่ยังไม่ถูกเพิ่มกลับเข้ารายการงาน)
function phase2Items(deal, items) {
  const fit = deal.analysis ? JSON.parse(deal.analysis).budget_fit : null;
  const titles = new Set(items.map((i) => i.title));
  return (fit?.deferred ?? []).filter((d) => !titles.has(d.title)).map((d) => ({ title: d.title, description: d.description, price: d.price }));
}

// ข้อมูลที่ "แช่แข็ง" ลงในเอกสาร ณ วันที่ออก
function snapshot(deal, settings) {
  const items = pricedItems(deal.id, settings);
  const totals = dealTotals(items, deal, settings);
  return {
    company: settings.company,
    customer: {
      name: deal.customer_name, company: deal.customer_company, email: deal.customer_email,
      phone: deal.customer_phone, tax_id: deal.customer_tax_id, address: deal.customer_address,
    },
    deal: { code: deal.code, title: deal.title, duration_days: deal.duration_days },
    items: items.map((i) => ({ title: i.title, description: i.description, days: i.days, price: i.price })),
    totals,
    payment_terms: settings.payment_terms,
    sales: q.get('SELECT name, email, phone FROM users WHERE id = ?', deal.sales_id) ?? null,
    quote_note: String(deal.quote_note || '').trim(),
    phase2: phase2Items(deal, items),
  };
}

function createDocument(deal, type, prefix, { amount, due_at = null, ref_id = null, data, status = 'issued', issued_at = today() }) {
  const number = nextCode('documents', 'number', prefix);
  const r = q.run(
    'INSERT INTO documents (deal_id, type, number, issued_at, due_at, amount, status, ref_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    deal.id, type, number, issued_at, due_at, amount, status, ref_id, JSON.stringify(data),
  );
  return { id: Number(r.lastInsertRowid), number };
}

function issueQuotation(deal, settings) {
  const data = snapshot(deal, settings);
  data.valid_until = addDays(today(), settings.pricing.quote_valid_days);
  q.run("UPDATE documents SET status = 'void' WHERE deal_id = ? AND type = 'quotation' AND status = 'issued'", deal.id);
  return createDocument(deal, 'quotation', 'QT', { amount: data.totals.total, due_at: data.valid_until, data });
}

// ---------- routes ----------
// รายชื่อลูกค้าเดิมในระบบ ใช้เติมข้อมูลผู้ติดต่อตอนเปิดงานขายใหม่
router.get('/customers', sales, (_req, res) => {
  const seen = new Set();
  const out = [];
  for (const d of q.all('SELECT customer_name, customer_company, customer_phone, customer_email, customer_tax_id, customer_address FROM deals ORDER BY id DESC')) {
    const key = `${(d.customer_company || '').trim().toLowerCase()}|${d.customer_name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  res.json(out);
});

router.get('/', view, (req, res) => {
  const settings = getSettings();
  const rows = seesAll(req.user)
    ? q.all('SELECT * FROM deals ORDER BY id DESC')
    : q.all('SELECT * FROM deals WHERE sales_id = ? ORDER BY id DESC', req.user.id);
  res.json(rows.map((d) => {
    const items = pricedItems(d.id, settings);
    const totals = dealTotals(items, d, settings);
    return {
      id: d.id, code: d.code, title: d.title, customer_name: d.customer_name, customer_company: d.customer_company,
      status: d.status, step: currentStep(d, settings.sales_steps), deadline: d.deadline, created_at: d.created_at, duration_days: d.duration_days,
      net: totals.net, feasibility: items.length ? feasibility(d, totals, settings).score : null,
      sales_name: q.get('SELECT name FROM users WHERE id = ?', d.sales_id)?.name ?? null,
    };
  }));
});

router.post('/', sales, (req, res) => {
  const b = req.body || {};
  if (!normalizePhone(b)) return res.status(400).json({ error: 'เบอร์โทรศัพท์ต้องเป็นตัวเลขไม่เกิน 10 หลัก' });
  normalizeChecks(b);
  if (!b.title?.trim() || !b.customer_name?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่องานและชื่อลูกค้า' });
  const sp = resolveSalesperson(b.salesperson, req.user);
  if (sp.error) return res.status(400).json({ error: sp.error });
  const code = nextCode('deals', 'code', 'DL');
  const r = q.run(
    `INSERT INTO deals (code, sales_id, ${FIELDS.join(', ')}) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')})`,
    code, sp.id, ...FIELDS.map((f) => (b[f] === '' || b[f] == null ? (f === 'requirement' ? '' : f === 'requirement_checks' ? '[]' : null) : b[f])),
  );
  const id = Number(r.lastInsertRowid);
  if (sp.id !== req.user.id) notify({ user_id: sp.id, title: `คุณได้รับมอบหมายงานขาย ${code}`, body: b.title.trim(), link: `/deals/${id}` });
  if (sp.created) {
    for (const uid of adminIds()) notify({ user_id: uid, title: `เพิ่มสมาชิกใหม่: ${sp.name}`, body: `พนักงานขาย · เพิ่มจากงานขาย ${code} โดย ${req.user.name}`, link: '/members' });
  }
  // รหัสผ่านชั่วคราวส่งกลับครั้งเดียวตอนสร้างสมาชิกใหม่
  res.status(201).json({ id, code, salesperson: { id: sp.id, name: sp.name ?? req.user.name, email: sp.email, created: Boolean(sp.created), temp_password: sp.temp_password }, can_view: seesAll(req.user) || sp.id === req.user.id });
});

router.get('/:id', view, (req, res) => {
  const deal = findDeal(req, res);
  if (deal) res.json(loadDeal(deal));
});

// ฝ่ายขายแก้ข้อมูลลูกค้า/Requirement ได้จนกว่าจะปิดงาน ส่วน admin แก้ได้เสมอ
router.put('/:id', editors, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (CLOSED.includes(deal.status) && req.user.role !== 'admin') return res.status(409).json({ error: 'งานนี้ปิดแล้ว แก้ไขไม่ได้' });
  const b = req.body || {};
  if (!normalizePhone(b)) return res.status(400).json({ error: 'เบอร์โทรศัพท์ต้องเป็นตัวเลขไม่เกิน 10 หลัก' });
  normalizeChecks(b);
  // งบประมาณ: ตัวเลขมากกว่า 0 เท่านั้น ไม่งั้นถือว่าไม่ระบุ
  if ('budget' in b) b.budget = Number(b.budget) > 0 ? Math.round(Number(b.budget)) : null;
  const sets = FIELDS.filter((f) => f in b);
  if (sets.length) {
    q.run(
      `UPDATE deals SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
      ...sets.map((f) => (b[f] === '' ? (f === 'requirement' ? '' : null) : b[f])), deal.id,
    );
  }
  res.json(loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)));
});

router.delete('/:id', admin, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  // งานที่ปิดการขายแล้วมีโครงการ เอกสาร และรายรับผูกอยู่ จึงลบไม่ได้ เพื่อกันข้อมูลการเงินหาย
  if (deal.status === 'won') return res.status(409).json({ error: 'งานที่ปิดการขายแล้วลบไม่ได้' });
  // รายการงาน เอกสาร และข้อความคุยงานถูกลบตามไปด้วย (ON DELETE CASCADE)
  q.run('DELETE FROM deals WHERE id = ?', deal.id);
  res.json({ ok: true });
});

// วิเคราะห์ Requirement -> รายการงาน + man-day + ระยะเวลา
router.post('/:id/analyze', editors, async (req, res, next) => {
  try {
    const deal = findDeal(req, res);
    if (!deal) return;
    if (CLOSED.includes(deal.status)) return res.status(409).json({ error: 'งานนี้ปิดแล้ว' });
    if (!deal.requirement.trim() && !parseChecks(deal).length) return res.status(400).json({ error: 'กรุณาเลือกเช็คลิสต์หรือกรอกข้อมูลเพิ่มเติมก่อนวิเคราะห์' });

    let result;
    let notice = null;
    try {
      result = await analyzeRequirement(deal);
    } catch (err) {
      if (!(err instanceof AiUnavailable)) throw err;
      result = fallbackAnalyze(deal);
      notice = `${err.message} — ใช้การประเมินเบื้องต้นจากคำสำคัญแทน`;
    }

    const settings = getSettings();
    const { items: rawItems, duration_days, ...analysis } = result;
    // ลูกค้าแจ้งงบ: ปรับขอบเขตให้ราคาก่อน VAT ไม่เกินงบ (เลื่อนบางรายการไปเฟส 2 / ลดกำลังคน)
    const { items, fit } = fitToBudget(rawItems.map((it) => ({ ...it, effort: cleanEffort(it.effort) })), Number(deal.budget) || 0, settings);
    analysis.budget_fit = fit;
    tx(() => {
      replaceItems(deal.id, items);
      const priced = pricedItems(deal.id, settings);
      const total = dealTotals(priced, deal, settings).days;
      // ตัดขอบเขตแล้ว ระยะเวลาลดตามสัดส่วน man-day
      const ratio = fit && fit.status !== 'within' ? total / Math.max(1, rawItems.reduce((s, it) => s + Object.values(cleanEffort(it.effort)).reduce((a, b) => a + b, 0), 0)) : 1;
      const duration = Math.round(duration_days) > 0 ? Math.max(5, Math.round(duration_days * ratio)) : suggestDuration(total, settings);
      q.run(
        "UPDATE deals SET analysis = ?, duration_days = ?, discount = 0, status = CASE WHEN status = 'draft' THEN 'analyzed' ELSE status END WHERE id = ?",
        JSON.stringify({ ...analysis, analyzed_at: new Date().toISOString() }), duration, deal.id,
      );
      // ราคาจากการวิเคราะห์เป็นราคาตั้งต้นสำหรับคุมเพดานส่วนลดของพนักงานขาย
      q.run('UPDATE deals SET price_base = ? WHERE id = ?', dealTotals(pricedItems(deal.id, settings), { discount: 0 }, settings).net, deal.id);
    });
    // พนักงานขายรับงานและกดวิเคราะห์แล้ว: แจ้งผู้ถือหุ้นให้กดเลือก dev รับงาน (แจ้งจนกว่าจะมี dev)
    if (!deal.dev_id) {
      const seller = q.get('SELECT name FROM users WHERE id = ?', deal.sales_id)?.name ?? req.user.name;
      for (const sh of q.all("SELECT id FROM users WHERE role = 'shareholder' AND active = 1")) {
        notify({ user_id: sh.id, title: `งานขาย ${deal.code} วิเคราะห์แล้ว รอเลือก dev`, body: `${deal.title} — พนักงานขาย ${seller}`, link: `/deals/${deal.id}` });
      }
    }
    res.json({ ...loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)), notice });
  } catch (e) {
    next(e);
  }
});

// สร้างหน้า Demo ตาม Requirement
router.post('/:id/demo', sales, async (req, res, next) => {
  try {
    const deal = findDeal(req, res);
    if (!deal) return;
    const settings = getSettings();
    const items = pricedItems(deal.id, settings);
    if (!items.length) return res.status(400).json({ error: 'กรุณาวิเคราะห์ Requirement ก่อนสร้าง Demo' });

    let out;
    let notice = null;
    try {
      out = await generateDemo(deal, items);
    } catch (err) {
      if (!(err instanceof AiUnavailable)) throw err;
      out = { html: fallbackDemo(deal, items), source: 'fallback' };
      notice = `${err.message} — แสดงโครงหน้าจอตัวอย่างแทน`;
    }
    q.run('UPDATE deals SET demo_html = ?, demo_source = ? WHERE id = ?', out.html, out.source, deal.id);
    res.json({ ...loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)), notice });
  } catch (e) {
    next(e);
  }
});

// admin ปรับรายการงาน ราคา ส่วนลด และระยะเวลาก่อนรับงาน
// ปรับรายการงาน ราคา ส่วนลด และระยะเวลา (ต่อรองกับลูกค้า): admin ผู้ถือหุ้น และพนักงานขายเจ้าของงาน
// กรรมการดูได้อย่างเดียว · findDeal จำกัดพนักงานขายให้แก้ได้เฉพาะงานของตัวเอง
router.put('/:id/estimate', requireRole('admin', 'shareholder', ...SELL_ROLES), (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (deal.status === 'won') return res.status(409).json({ error: 'ปิดการขายแล้ว แก้ราคาไม่ได้' });
  const { items, discount, duration_days } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'รูปแบบรายการงานไม่ถูกต้อง' });
  const settings = getSettings();
  const before = dealTotals(pricedItems(deal.id, settings), deal, settings);
  // ราคาที่จะได้หลังบันทึก (คำนวณก่อนเพื่อตรวจเพดานส่วนลด)
  const draftItems = items.map((it) => priceItem({ effort: cleanEffort(it.effort), price_override: it.price_override === '' || it.price_override == null ? null : Number(it.price_override) }, settings));
  const next = dealTotals(draftItems, { discount: Math.max(0, Number(discount) || 0) }, settings);
  if (!isPriceAuthority(req.user)) {
    const { price_min, max_sales_discount_percent } = priceLimit(deal, settings);
    if (next.net < price_min) {
      return res.status(400).json({ error: `ลดราคาได้ไม่เกิน ${max_sales_discount_percent}% — ราคาก่อน VAT ต้องไม่ต่ำกว่า ${price_min.toLocaleString('th-TH')} บาท (ตอนนี้ ${next.net.toLocaleString('th-TH')} บาท) ถ้าต้องการลดมากกว่านี้ให้ผู้ถือหุ้นหรือผู้ดูแลระบบปรับให้` });
    }
  }
  tx(() => {
    replaceItems(deal.id, items);
    q.run(
      "UPDATE deals SET discount = ?, duration_days = ?, status = CASE WHEN status = 'draft' THEN 'analyzed' ELSE status END WHERE id = ?",
      Math.max(0, Number(discount) || 0), Math.max(0, Math.round(Number(duration_days) || 0)), deal.id,
    );
    // admin/ผู้ถือหุ้นกำหนดราคาใหม่ = ราคาตั้งต้นใหม่สำหรับเพดานส่วนลดของพนักงานขาย
    if (isPriceAuthority(req.user)) q.run('UPDATE deals SET price_base = ? WHERE id = ?', next.net, deal.id);
  });
  // พนักงานขายปรับราคาเพื่อต่อรอง: แจ้ง admin และผู้ถือหุ้นให้เห็นยอดก่อน-หลัง
  if (!['admin', 'shareholder'].includes(req.user.role)) {
    const after = dealTotals(pricedItems(deal.id, settings), q.get('SELECT * FROM deals WHERE id = ?', deal.id), settings);
    if (after.net !== before.net) {
      const fmt = (n) => n.toLocaleString('th-TH');
      const below = after.net < after.cost ? ' · ต่ำกว่าต้นทุนค่าแรง' : '';
      for (const u of q.all("SELECT id FROM users WHERE role IN ('admin', 'shareholder') AND active = 1")) {
        notify({ user_id: u.id, title: `${req.user.name} ปรับราคา ${deal.code}`, body: `${deal.title} — ก่อน VAT ${fmt(before.net)} → ${fmt(after.net)} บาท${below}`, link: `/deals/${deal.id}` });
      }
    }
  }
  res.json(loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)));
});

// ย้ายงานขายไปขั้นตอนที่เลือก (ขั้นตอนปิดการขายต้องทำผ่านปุ่มปิดการขาย)
router.put('/:id/step', sales, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (CLOSED.includes(deal.status)) return res.status(409).json({ error: 'งานนี้ปิดแล้ว เปลี่ยนขั้นตอนไม่ได้' });
  const steps = getSettings().sales_steps;
  const target = steps.findIndex((s) => s.id === req.body?.step);
  if (target < 0) return res.status(400).json({ error: 'ไม่พบขั้นตอนนี้' });
  if (steps[target].id === 'won') return res.status(400).json({ error: 'กรุณาใช้ปุ่ม “ปิดการขาย” เพื่อปิดงาน' });
  // สถานะของระบบ = ขั้นตอนของระบบตัวล่าสุดที่อยู่ไม่เกินขั้นตอนที่เลือก
  const status = steps.slice(0, target + 1).map((s) => s.id).filter((id) => SYSTEM_STEPS.includes(id)).pop() ?? 'draft';
  q.run('UPDATE deals SET step = ?, status = ? WHERE id = ?', steps[target].id, status, deal.id);
  res.json(loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)));
});

// admin แนบลิงก์ Demo ให้พนักงานขายนำไปเสนอลูกค้า (ส่งค่าว่างเพื่อลบลิงก์)
router.put('/:id/demo-link', admin, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const { url, error } = cleanHttpUrl(req.body?.url);
  if (error) return res.status(400).json({ error });
  q.run('UPDATE deals SET demo_url = ? WHERE id = ?', url, deal.id);
  if (url && url !== deal.demo_url && deal.sales_id && deal.sales_id !== req.user.id) {
    notify({ user_id: deal.sales_id, title: `มีลิงก์ Demo สำหรับ ${deal.code}`, body: `${deal.title} — พร้อมนำเสนอลูกค้า`, link: `/deals/${deal.id}` });
  }
  res.json(loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)));
});

// ออกใบเสนอราคา
router.post('/:id/quote', sales, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (CLOSED.includes(deal.status)) return res.status(409).json({ error: 'งานนี้ปิดแล้ว' });
  const settings = getSettings();
  if (!pricedItems(deal.id, settings).length) return res.status(400).json({ error: 'ยังไม่มีรายการงานสำหรับออกใบเสนอราคา' });
  tx(() => {
    issueQuotation(deal, settings);
    q.run("UPDATE deals SET status = 'quoted' WHERE id = ?", deal.id);
  });
  res.json(loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)));
});

// ปิดงาน: won -> ออกสัญญา + ใบแจ้งหนี้ตามงวด + เปิดโครงการ
router.post('/:id/close', sales, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (CLOSED.includes(deal.status)) return res.status(409).json({ error: 'งานนี้ปิดไปแล้ว' });
  const { result, start_date, note } = req.body || {};

  if (result === 'lost') {
    q.run("UPDATE deals SET status = 'lost', closed_at = datetime('now'), close_note = ? WHERE id = ?", note || null, deal.id);
    return res.json(loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)));
  }
  if (result !== 'won') return res.status(400).json({ error: 'ระบุผลการปิดงานไม่ถูกต้อง' });

  const settings = getSettings();
  const items = pricedItems(deal.id, settings);
  const totals = dealTotals(items, deal, settings);
  if (!items.length || totals.net <= 0) return res.status(400).json({ error: 'ต้องมีรายการงานและราคาก่อนปิดการขาย' });
  if (deal.duration_days <= 0) return res.status(400).json({ error: 'กรุณาให้ admin กำหนดระยะเวลาทำงานก่อนปิดการขาย' });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(start_date || '') ? start_date : today();

  const projectId = tx(() => {
    const hasQuote = q.get("SELECT id FROM documents WHERE deal_id = ? AND type = 'quotation' AND status = 'issued'", deal.id);
    if (!hasQuote) issueQuotation(deal, settings);

    const end = addBusinessDays(start, deal.duration_days);
    const base = { ...snapshot(deal, settings), start_date: start, end_date: end };
    createDocument(deal, 'contract', 'CT', { amount: totals.total, data: base });

    // ใบแจ้งหนี้ตามงวด — งวดสุดท้ายรับเศษที่เหลือ
    const terms = settings.payment_terms.filter((t) => t.percent > 0);
    let usedNet = 0;
    terms.forEach((t, i) => {
      const last = i === terms.length - 1;
      const net = last ? totals.net - usedNet : Math.round(totals.net * t.percent) / 100;
      usedNet += net;
      const vat = Math.round(net * totals.vat_percent) / 100;
      const due = i === 0 ? addBusinessDays(start, 5) : last ? addBusinessDays(end, 5) : addBusinessDays(start, Math.round((deal.duration_days * i) / (terms.length - 1)));
      createDocument(deal, 'invoice', 'INV', {
        amount: net + vat, due_at: due,
        data: { ...base, installment: { no: i + 1, of: terms.length, label: t.label, percent: t.percent, net, vat, total: net + vat } },
      });
    });

    q.run("UPDATE deals SET status = 'won', closed_at = datetime('now'), close_note = ? WHERE id = ?", note || null, deal.id);
    const pid = createProjectFromDeal(deal, items, totals, start, end);
    for (const uid of new Set([...adminIds(), deal.sales_id])) {
      // ผู้ที่ดูโครงการไม่ได้ (ฝ่ายขาย) ให้ลิงก์กลับไปที่งานขาย
      const role = q.get('SELECT role FROM users WHERE id = ?', uid)?.role;
      const link = PROJECT_ROLES.includes(role) ? `/projects/${pid}` : `/deals/${deal.id}`;
      notify({ user_id: uid, title: `ปิดการขาย ${deal.code}`, body: `${deal.title} — เปิดโครงการและออกเอกสารแล้ว`, link });
    }
    return pid;
  });

  res.json({ ...loadDeal(q.get('SELECT * FROM deals WHERE id = ?', deal.id)), project_id: projectId });
});

// ---------- เอกสาร ----------
export const documents = Router();

documents.get('/:id', view, (req, res) => {
  const doc = q.get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  const deal = q.get('SELECT * FROM deals WHERE id = ?', doc.deal_id);
  if (!canSee(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูเอกสารนี้' });
  const ref = doc.ref_id ? q.get('SELECT number FROM documents WHERE id = ?', doc.ref_id) : null;
  // เอกสารเก่าที่ออกก่อนกรอกที่อยู่/เบอร์บริษัท: เติมเฉพาะช่องที่ว่างจากข้อมูลบริษัทปัจจุบัน
  const data = JSON.parse(doc.data);
  if (data.company) {
    const now = getSettings().company;
    for (const k of ['address', 'phone', 'email', 'tax_id']) if (!data.company[k] && now[k]) data.company[k] = now[k];
  }
  res.json({ ...doc, data, ref_number: ref?.number ?? null });
});

// รับชำระใบแจ้งหนี้ -> ออกใบเสร็จรับเงิน + บันทึกรายรับ (ยอดก่อน VAT)
documents.post('/:id/pay', admin, (req, res) => {
  const inv = q.get("SELECT * FROM documents WHERE id = ? AND type = 'invoice'", req.params.id);
  if (!inv) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (inv.status !== 'issued') return res.status(409).json({ error: 'ใบแจ้งหนี้นี้รับชำระแล้วหรือถูกยกเลิก' });
  const deal = q.get('SELECT * FROM deals WHERE id = ?', inv.deal_id);
  const data = JSON.parse(inv.data);
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : today();
  const project = q.get('SELECT id FROM projects WHERE deal_id = ?', deal.id);

  const receipt = tx(() => {
    q.run("UPDATE documents SET status = 'paid' WHERE id = ?", inv.id);
    const r = createDocument(deal, 'receipt', 'RC', {
      amount: inv.amount, ref_id: inv.id, status: 'paid', issued_at: paidAt,
      data: { ...data, paid_at: paidAt, method: req.body?.method || 'โอนเงิน' },
    });
    q.run(
      "INSERT INTO transactions (project_id, type, category, amount, date, note, document_id) VALUES (?, 'income', 'รับชำระค่างาน', ?, ?, ?, ?)",
      project?.id ?? null, data.installment.net, paidAt,
      `${inv.number} ${data.installment.label} (VAT ${data.installment.vat.toLocaleString('th-TH')} บาท แยกต่างหาก)`, r.id,
    );
    if (deal.sales_id) notify({ user_id: deal.sales_id, title: `รับชำระ ${inv.number}`, body: deal.title, link: `/deals/${deal.id}` });
    return r;
  });
  res.json(receipt);
});

export default router;
