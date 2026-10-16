// งานเพิ่มเติมหลังปิดการขาย (change request)
// งานขายที่ปิดแล้ว -> สร้างรายการงานเพิ่ม -> ออกใบเสนอราคาเพิ่มเติม -> ลูกค้าอนุมัติ
// -> ออกใบแจ้งหนี้ เพิ่มมูลค่าและงานเข้าโครงการ (ใบเสนอราคาหลักไม่ถูกยกเลิก)
import { Router } from 'express';
import { q, tx, getSettings, nextCode, today, addDays, addBusinessDays, notify } from '../db.js';
import { requireAuth, seesAll } from '../auth.js';
import { priceItem, dealTotals, cleanEffort } from '../estimator.js';
import { positionByCode } from '../positions.js';

const router = Router();
// กำหนดราคาเอง/ส่วนลดได้ (ต่อรองกับลูกค้า): admin ผู้ถือหุ้น และพนักงานขายเจ้าของงาน
const canPrice = (user, deal) => ['admin', 'shareholder'].includes(user.role) || deal.sales_id === user.id;
const STATUS_LABEL = { draft: 'ร่าง', quoted: 'เสนอราคาแล้ว', approved: 'ลูกค้าอนุมัติ', rejected: 'ลูกค้าไม่อนุมัติ' };

// งานขายที่ผู้ใช้มีสิทธิ์: ดูได้ = ดูได้ทั้งหมด หรือพนักงานขายเจ้าของงาน
function findDeal(req, res) {
  const deal = q.get('SELECT * FROM deals WHERE id = ?', req.params.id);
  if (!deal) return res.status(404).json({ error: 'ไม่พบงานขายนี้' }) && null;
  if (!seesAll(req.user) && deal.sales_id !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์ในงานขายนี้' }) && null;
  return deal;
}
// เพิ่ม/แก้งานเพิ่ม: admin ผู้ถือหุ้น และพนักงานขายเจ้าของงาน · ออกเอกสาร/บันทึกผลลูกค้า: admin และพนักงานขายเจ้าของงาน
const canEdit = (user, deal) => canPrice(user, deal);
const canDecide = (user, deal) => user.role === 'admin' || deal.sales_id === user.id;

function findExtra(req, res, deal) {
  const ex = q.get('SELECT * FROM deal_extras WHERE id = ? AND deal_id = ?', req.params.eid, deal.id);
  if (!ex) res.status(404).json({ error: 'ไม่พบงานเพิ่มเติมนี้' });
  return ex;
}

// คำนวณราคาของงานเพิ่มด้วยอัตราค่าแรงเดียวกับใบเสนอราคาหลัก
function priced(ex, settings = getSettings()) {
  const items = JSON.parse(ex.items || '[]').map((i) => priceItem(i, settings));
  const totals = dealTotals(items, { discount: ex.discount }, settings);
  return { ...ex, items, totals, status_label: STATUS_LABEL[ex.status] };
}

// พนักงานขาย: ราคาก่อน VAT ของงานเพิ่มต้องไม่ต่ำกว่าราคาคำนวณจากกำลังคน × (100 − เพดาน)%
function overLimit(user, items, discount, settings) {
  if (['admin', 'shareholder'].includes(user.role)) return null;
  const pct = Number(settings.pricing.max_sales_discount_percent) || 0;
  const base = dealTotals(items.map((i) => priceItem({ ...i, price_override: null }, settings)), { discount: 0 }, settings).net;
  const net = dealTotals(items.map((i) => priceItem(i, settings)), { discount }, settings).net;
  const min = Math.ceil(base * (100 - pct)) / 100;
  return net < min ? `ลดราคาได้ไม่เกิน ${pct}% — ราคาก่อน VAT ต้องไม่ต่ำกว่า ${min.toLocaleString('th-TH')} บาท (ตอนนี้ ${net.toLocaleString('th-TH')} บาท)` : null;
}

function cleanItems(raw, user, deal, old = []) {
  if (!Array.isArray(raw)) return null;
  return raw.map((it, i) => {
    const override = it.price_override === '' || it.price_override == null ? null : Number(it.price_override);
    return {
      title: String(it.title || 'รายการ').trim().slice(0, 200),
      description: String(it.description || '').trim().slice(0, 500),
      effort: cleanEffort(it.effort),
      // ราคากำหนดเองใส่ได้เฉพาะ admin/ผู้ถือหุ้น คนอื่นคงค่าเดิมของรายการนั้นไว้
      price_override: canPrice(user, deal) ? (Number.isFinite(override) ? override : null) : (old[i]?.price_override ?? null),
    };
  }).filter((it) => it.title);
}

router.get('/:id/extras', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const settings = getSettings();
  res.json(q.all('SELECT * FROM deal_extras WHERE deal_id = ? ORDER BY no', deal.id).map((ex) => {
    const out = priced(ex, settings);
    out.quote = ex.quote_id ? q.get('SELECT id, number, status FROM documents WHERE id = ?', ex.quote_id) : null;
    out.invoice = ex.invoice_id ? q.get('SELECT id, number, status, due_at FROM documents WHERE id = ?', ex.invoice_id) : null;
    return out;
  }));
});

router.post('/:id/extras', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (deal.status !== 'won') return res.status(409).json({ error: 'เพิ่มงานเพิ่มเติมได้หลังปิดการขายแล้วเท่านั้น' });
  if (!canEdit(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เพิ่มงานเพิ่มเติม' });
  const b = req.body || {};
  const items = cleanItems(b.items, req.user, deal);
  if (!String(b.title || '').trim()) return res.status(400).json({ error: 'กรุณาตั้งชื่องานเพิ่มเติม' });
  if (!items?.length) return res.status(400).json({ error: 'ต้องมีรายการงานอย่างน้อย 1 รายการ' });
  const discountIn = canPrice(req.user, deal) ? Math.max(0, Number(b.discount) || 0) : 0;
  const limitErr = overLimit(req.user, items, discountIn, getSettings());
  if (limitErr) return res.status(400).json({ error: limitErr });
  const no = (q.get('SELECT MAX(no) AS n FROM deal_extras WHERE deal_id = ?', deal.id).n ?? 0) + 1;
  const r = q.run(
    'INSERT INTO deal_extras (deal_id, no, title, items, discount, duration_days, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    deal.id, no, String(b.title).trim().slice(0, 200), JSON.stringify(items),
    canPrice(req.user, deal) ? Math.max(0, Number(b.discount) || 0) : 0,
    Math.max(1, Math.round(Number(b.duration_days) || 1)), String(b.note || '').trim().slice(0, 3000), req.user.id,
  );
  res.status(201).json(priced(q.get('SELECT * FROM deal_extras WHERE id = ?', r.lastInsertRowid)));
});

router.put('/:id/extras/:eid', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const ex = findExtra(req, res, deal);
  if (!ex) return;
  if (!canEdit(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขงานเพิ่มเติม' });
  if (ex.status !== 'draft') return res.status(409).json({ error: 'ออกใบเสนอราคาแล้ว แก้ไขไม่ได้' });
  const b = req.body || {};
  const items = cleanItems(b.items, req.user, deal, JSON.parse(ex.items || '[]'));
  if (!items?.length) return res.status(400).json({ error: 'ต้องมีรายการงานอย่างน้อย 1 รายการ' });
  const limitErr = overLimit(req.user, items, canPrice(req.user, deal) ? Math.max(0, Number(b.discount) || 0) : ex.discount, getSettings());
  if (limitErr) return res.status(400).json({ error: limitErr });
  q.run(
    'UPDATE deal_extras SET title = ?, items = ?, discount = ?, duration_days = ?, note = ? WHERE id = ?',
    String(b.title || ex.title).trim().slice(0, 200), JSON.stringify(items),
    canPrice(req.user, deal) ? Math.max(0, Number(b.discount) || 0) : ex.discount,
    Math.max(1, Math.round(Number(b.duration_days) || ex.duration_days)), String(b.note ?? ex.note ?? '').trim().slice(0, 3000), ex.id,
  );
  res.json(priced(q.get('SELECT * FROM deal_extras WHERE id = ?', ex.id)));
});

router.delete('/:id/extras/:eid', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const ex = findExtra(req, res, deal);
  if (!ex) return;
  if (!canEdit(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบงานเพิ่มเติม' });
  if (ex.status !== 'draft') return res.status(409).json({ error: 'ลบได้เฉพาะงานเพิ่มเติมที่ยังเป็นร่าง' });
  q.run('DELETE FROM deal_extras WHERE id = ?', ex.id);
  res.json({ ok: true });
});

// ข้อมูลที่ "แช่แข็ง" ลงเอกสารของงานเพิ่ม
function snapshot(deal, ex, settings) {
  const p = priced(ex, settings);
  const contract = q.get("SELECT number FROM documents WHERE deal_id = ? AND type = 'contract' ORDER BY id LIMIT 1", deal.id);
  return {
    company: settings.company,
    customer: {
      name: deal.customer_name, company: deal.customer_company, email: deal.customer_email,
      phone: deal.customer_phone, tax_id: deal.customer_tax_id, address: deal.customer_address,
    },
    deal: { code: deal.code, title: deal.title, duration_days: ex.duration_days },
    extra: { no: ex.no, title: ex.title, contract: contract?.number ?? null },
    items: p.items.map((i) => ({ title: i.title, description: i.description, days: i.days, price: i.price })),
    totals: p.totals,
    payment_terms: [{ label: 'ชำระเต็มจำนวนเมื่อลูกค้าอนุมัติงานเพิ่มเติม', percent: 100 }],
    sales: q.get('SELECT name, email, phone FROM users WHERE id = ?', deal.sales_id) ?? null,
    quote_note: String(ex.note || '').trim(),
  };
}

function insertDoc(deal, type, prefix, { amount, due_at = null, data, status = 'issued' }) {
  const number = nextCode('documents', 'number', prefix);
  const r = q.run(
    'INSERT INTO documents (deal_id, type, number, issued_at, due_at, amount, status, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    deal.id, type, number, today(), due_at, amount, status, JSON.stringify(data),
  );
  return { id: Number(r.lastInsertRowid), number };
}

// ออกใบเสนอราคาเพิ่มเติม (ไม่ยกเลิกใบเสนอราคาหลัก)
router.post('/:id/extras/:eid/quote', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const ex = findExtra(req, res, deal);
  if (!ex) return;
  if (!canDecide(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ออกใบเสนอราคา' });
  if (ex.status !== 'draft') return res.status(409).json({ error: 'ออกใบเสนอราคาไปแล้ว' });
  const settings = getSettings();
  const data = snapshot(deal, ex, settings);
  if (data.totals.net <= 0) return res.status(400).json({ error: 'ราคางานเพิ่มเติมต้องมากกว่า 0' });
  data.valid_until = addDays(today(), settings.pricing.quote_valid_days);
  const doc = tx(() => {
    const d = insertDoc(deal, 'quotation', 'QT', { amount: data.totals.total, due_at: data.valid_until, data });
    q.run("UPDATE deal_extras SET status = 'quoted', quote_id = ? WHERE id = ?", d.id, ex.id);
    return d;
  });
  res.json({ ok: true, quote: doc });
});

// ลูกค้าอนุมัติ: ออกใบแจ้งหนี้ เพิ่มมูลค่าโครงการ เพิ่มงานตามตำแหน่ง และขยายวันส่งมอบถ้าจำเป็น
router.post('/:id/extras/:eid/approve', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const ex = findExtra(req, res, deal);
  if (!ex) return;
  if (!canDecide(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์บันทึกผลการอนุมัติ' });
  if (ex.status !== 'quoted') return res.status(409).json({ error: 'ต้องออกใบเสนอราคาเพิ่มเติมก่อน' });
  const project = q.get('SELECT * FROM projects WHERE deal_id = ?', deal.id);
  if (!project) return res.status(409).json({ error: 'ไม่พบโครงการของงานขายนี้' });

  const settings = getSettings();
  const p = priced(ex, settings);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.start_date || '') ? req.body.start_date : today();
  const due = addBusinessDays(start, ex.duration_days);

  const invoice = tx(() => {
    const t = p.totals;
    const data = { ...snapshot(deal, ex, settings), installment: { no: 1, of: 1, label: `งานเพิ่มเติม #${ex.no} ${ex.title}`, percent: 100, net: t.net, vat: t.vat, total: t.total } };
    const inv = insertDoc(deal, 'invoice', 'INV', { amount: t.total, due_at: addBusinessDays(today(), 5), data });

    // งานในโครงการ: รายการ × ตำแหน่ง ช่วงงานตามตำแหน่ง ผู้รับผิดชอบตามทีมของโครงการ
    const roleUser = (code) => q.get('SELECT user_id FROM project_roles WHERE project_id = ? AND position = ? AND user_id IS NOT NULL', project.id, code)?.user_id
      ?? q.get('SELECT id FROM users WHERE position = ? AND active = 1 ORDER BY id LIMIT 1', code)?.id ?? null;
    const addDaysByPos = {};
    for (const it of p.items) {
      for (const [code, d] of Object.entries(it.effort)) {
        q.run(
          'INSERT INTO tasks (project_id, phase, title, position, assignee_id, start_date, due_date, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          project.id, positionByCode[code].phase, `งานเพิ่ม #${ex.no}: ${it.title}`, code, roleUser(code), start, due, d,
        );
        addDaysByPos[code] = (addDaysByPos[code] || 0) + d;
      }
    }
    // สัดส่วนงานของทีม: เพิ่ม man-day แล้วคำนวณ % ใหม่ (สัดส่วนผลประโยชน์เดิมไม่เปลี่ยน ตำแหน่งใหม่ตั้งเท่ากับ % งาน)
    for (const [code, d] of Object.entries(addDaysByPos)) {
      const row = q.get('SELECT id FROM project_roles WHERE project_id = ? AND position = ?', project.id, code);
      if (row) q.run('UPDATE project_roles SET days = days + ? WHERE id = ?', d, row.id);
      else q.run('INSERT INTO project_roles (project_id, position, user_id, days, percent, share_percent) VALUES (?, ?, ?, ?, 0, -1)', project.id, code, roleUser(code), d);
    }
    const totalDays = q.get('SELECT SUM(days) AS s FROM project_roles WHERE project_id = ?', project.id).s || 1;
    for (const r of q.all('SELECT id, days, share_percent FROM project_roles WHERE project_id = ?', project.id)) {
      const pct = Math.round((r.days / totalDays) * 1000) / 10;
      q.run('UPDATE project_roles SET percent = ?, share_percent = CASE WHEN share_percent < 0 THEN ? ELSE share_percent END WHERE id = ?', pct, pct, r.id);
    }
    q.run(
      "UPDATE projects SET budget = budget + ?, end_date = CASE WHEN end_date < ? THEN ? ELSE end_date END, status = CASE WHEN status = 'done' THEN 'active' ELSE status END WHERE id = ?",
      t.net, due, due, project.id,
    );
    q.run("UPDATE deal_extras SET status = 'approved', invoice_id = ?, approved_at = datetime('now') WHERE id = ?", inv.id, ex.id);

    const msg = `${deal.title} — มูลค่าเพิ่ม ${t.net.toLocaleString('th-TH')} บาท (ก่อน VAT) · ${ex.duration_days} วันทำการ`;
    const who = new Set([...q.all("SELECT id FROM users WHERE role IN ('admin', 'shareholder') AND active = 1").map((u) => u.id), deal.sales_id, deal.dev_id]);
    for (const uid of who) {
      if (uid && uid !== req.user.id) notify({ user_id: uid, title: `ลูกค้าอนุมัติงานเพิ่มเติม #${ex.no} ของ ${deal.code}`, body: msg, link: `/deals/${deal.id}` });
    }
    return inv;
  });
  res.json({ ok: true, invoice });
});

router.post('/:id/extras/:eid/reject', requireAuth, (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const ex = findExtra(req, res, deal);
  if (!ex) return;
  if (!canDecide(req.user, deal)) return res.status(403).json({ error: 'ไม่มีสิทธิ์บันทึกผลการอนุมัติ' });
  if (ex.status !== 'quoted') return res.status(409).json({ error: 'บันทึกได้เฉพาะงานเพิ่มเติมที่เสนอราคาแล้ว' });
  tx(() => {
    q.run("UPDATE deal_extras SET status = 'rejected' WHERE id = ?", ex.id);
    if (ex.quote_id) q.run("UPDATE documents SET status = 'void' WHERE id = ?", ex.quote_id);
  });
  res.json({ ok: true });
});

export default router;
