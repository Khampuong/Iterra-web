// เมนูการเงิน (บัญชี): ผังบัญชี สมุดรายวัน วางบิล/รับชำระ บันทึกค่าใช้จ่าย งบทดลอง รายงานภาษี
import { Router } from 'express';
import { q, today } from '../db.js';
import { requireRole, WIDE_ROLES } from '../auth.js';
import {
  ACCOUNT_TYPES, TYPE_DIGIT, LedgerError, accountByCode, balances, billInvoice, billingEntry, checkLedger,
  entriesWithLines, paymentEntry, postEntry, recordExpense, reverseEntry, vatReport, whtReport,
} from '../ledger.js';

const router = Router();
const viewer = requireRole(...WIDE_ROLES); // ดูได้: admin ผู้ถือหุ้น กรรมการ
const admin = requireRole('admin'); // บันทึกบัญชีได้เฉพาะผู้ดูแลระบบ

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));

// แปลงข้อผิดพลาดทางบัญชีเป็น 400 พร้อมข้อความ
const guard = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (e) {
    if (e instanceof LedgerError) return res.status(400).json({ error: e.message });
    next(e);
  }
};

router.get('/accounting/summary', viewer, (_req, res) => {
  const t = today();
  const yearStart = `${t.slice(0, 4)}-01-01`;
  const all = balances({ to: t });
  const ytd = balances({ from: yearStart, to: t });
  const bal = (code) => all.find((b) => b.code === code)?.balance ?? 0;
  const sumType = (rows, type) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.balance, 0);
  const revenue = sumType(ytd, 'revenue');
  const cost = sumType(ytd, 'cost');
  const expense = sumType(ytd, 'expense');
  const invoices = q.all("SELECT * FROM documents WHERE type = 'invoice' AND status != 'void'");
  res.json({
    date: t,
    cash: bal('11100') + bal('11200') + bal('11210'),
    receivable: bal('11300'),
    vat_payable: bal('21300'), vat_pending: bal('21310'), wht_payable: bal('21400'), wht_credit: bal('11500'),
    ytd: { revenue, cost, expense, gross: revenue - cost, profit: revenue - cost - expense },
    invoices: {
      unbilled: invoices.filter((i) => i.status === 'issued' && !billingEntry(i.id)).length,
      billed: invoices.filter((i) => i.status === 'issued' && billingEntry(i.id)).length,
    },
    entries: q.get('SELECT COUNT(*) AS n FROM journal_entries').n,
    unbalanced: checkLedger(),
  });
});

// ---------- ผังบัญชี ----------
router.get('/accounting/accounts', viewer, (_req, res) => {
  const bal = balances({ to: today() });
  res.json({ types: ACCOUNT_TYPES, accounts: bal.map((b) => ({ ...accountByCode(b.code), balance: b.balance, used: b.debit + b.credit > 0 })) });
});

router.post('/accounting/accounts', admin, (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim();
  const name = String(b.name || '').trim().slice(0, 120);
  if (!ACCOUNT_TYPES[b.type]) return res.status(400).json({ error: 'กรุณาเลือกหมวดบัญชี' });
  if (!/^\d{5}$/.test(code)) return res.status(400).json({ error: 'รหัสบัญชีต้องเป็นตัวเลข 5 หลัก' });
  if (code[0] !== TYPE_DIGIT[b.type]) return res.status(400).json({ error: `รหัสหมวด${ACCOUNT_TYPES[b.type]}ต้องขึ้นต้นด้วย ${TYPE_DIGIT[b.type]}` });
  if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อบัญชี' });
  if (accountByCode(code)) return res.status(409).json({ error: `มีบัญชี ${code} อยู่แล้ว` });
  q.run('INSERT INTO accounts (code, name, type, note) VALUES (?, ?, ?, ?)', code, name, b.type, String(b.note || '').trim() || null);
  res.status(201).json(accountByCode(code));
});

// แก้ชื่อ/คำอธิบาย/เปิด-ปิดใช้งานได้ (รหัสและหมวดแก้ไม่ได้เพราะมีรายการบัญชีอ้างอิง)
router.put('/accounting/accounts/:code', admin, (req, res) => {
  const a = accountByCode(req.params.code);
  if (!a) return res.status(404).json({ error: 'ไม่พบบัญชี' });
  const b = req.body || {};
  const name = 'name' in b ? String(b.name || '').trim().slice(0, 120) : a.name;
  if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อบัญชี' });
  q.run('UPDATE accounts SET name = ?, note = ?, active = ? WHERE code = ?', name, 'note' in b ? String(b.note || '').trim() || null : a.note, 'active' in b ? (b.active ? 1 : 0) : a.active, a.code);
  res.json(accountByCode(a.code));
});

// ---------- สมุดรายวัน ----------
router.get('/accounting/journal', viewer, (req, res) => {
  const where = [];
  const params = [];
  if (isMonth(req.query.month)) { where.push('substr(e.date, 1, 7) = ?'); params.push(req.query.month); }
  if (req.query.source) { where.push('e.source = ?'); params.push(String(req.query.source)); }
  if (req.query.account) { where.push('e.id IN (SELECT entry_id FROM journal_lines WHERE account = ?)'); params.push(String(req.query.account)); }
  res.json(entriesWithLines(where.length ? `WHERE ${where.join(' AND ')}` : '', ...params));
});

// รายการบัญชีทั่วไป (ปรับปรุง/โอนเงิน/ทุน ฯลฯ) — ระบบตรวจ Dr = Cr ก่อนบันทึก
router.post('/accounting/journal', admin, guard((req, res) => {
  const b = req.body || {};
  if (b.date && !isDate(b.date)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
  const e = postEntry({
    date: b.date || today(), memo: b.memo, source: 'manual', user_id: req.user.id,
    project_id: b.project_id ? Number(b.project_id) : null,
    lines: (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || null })),
  });
  res.status(201).json(e);
}));

router.post('/accounting/journal/:id/reverse', admin, guard((req, res) => {
  const b = req.body || {};
  res.status(201).json(reverseEntry(Number(req.params.id), { date: isDate(b.date) ? b.date : today(), reason: String(b.reason || '').trim().slice(0, 200), user_id: req.user.id }));
}));

// ---------- ค่าใช้จ่าย ----------
router.post('/accounting/expenses', admin, guard((req, res) => {
  const b = req.body || {};
  if (b.date && !isDate(b.date)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
  res.status(201).json(recordExpense(b, req.user.id));
}));

// ---------- ใบแจ้งหนี้: วางบิล / รับชำระ ----------
router.get('/accounting/invoices', viewer, (_req, res) => {
  const rows = q.all(
    `SELECT d.*, dl.code AS deal_code, dl.title AS deal_title FROM documents d JOIN deals dl ON dl.id = d.deal_id
     WHERE d.type = 'invoice' AND d.status != 'void' ORDER BY d.due_at, d.id`,
  );
  res.json(rows.map((d) => {
    const data = JSON.parse(d.data);
    const bill = billingEntry(d.id);
    const pay = paymentEntry(d.id);
    const receipt = q.get("SELECT id, number FROM documents WHERE type = 'receipt' AND ref_id = ?", d.id);
    return {
      id: d.id, number: d.number, deal_id: d.deal_id, deal_code: d.deal_code, deal_title: d.deal_title, issued_at: d.issued_at, due_at: d.due_at, status: d.status,
      customer: data.customer.company || data.customer.name, installment: data.installment,
      billed: bill ? { number: bill.number, date: bill.date, revenue_account: JSON.parse(bill.meta || '{}').revenue_account } : null,
      paid: pay ? { number: pay.number, date: pay.date, ...JSON.parse(pay.meta || '{}') } : null,
      receipt,
    };
  }));
});

router.post('/accounting/invoices/:id/bill', admin, guard((req, res) => {
  const inv = q.get("SELECT * FROM documents WHERE id = ? AND type = 'invoice'", req.params.id);
  if (!inv) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (inv.status !== 'issued') return res.status(409).json({ error: 'ใบแจ้งหนี้นี้รับชำระแล้วหรือถูกยกเลิก' });
  const b = req.body || {};
  res.status(201).json(billInvoice(inv, { date: isDate(b.date) ? b.date : today(), revenue_account: b.revenue_account || '41100', user_id: req.user.id }));
}));

// ---------- รายงาน ----------
router.get('/accounting/trial-balance', viewer, (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : today();
  const rows = balances({ to }).filter((r) => r.debit || r.credit);
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  res.json({ to, rows, debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100, unbalanced: checkLedger() });
});

router.get('/accounting/ledger/:code', viewer, (req, res) => {
  const a = accountByCode(req.params.code);
  if (!a) return res.status(404).json({ error: 'ไม่พบบัญชี' });
  const debitNormal = ['asset', 'cost', 'expense'].includes(a.type);
  let running = 0;
  const lines = q.all(
    `SELECT l.debit, l.credit, l.memo AS line_memo, e.id AS entry_id, e.number, e.date, e.memo FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account = ? ORDER BY e.date, e.id, l.id`,
    a.code,
  ).map((l) => {
    running = Math.round((running + (debitNormal ? l.debit - l.credit : l.credit - l.debit)) * 100) / 100;
    return { ...l, balance: running };
  });
  res.json({ account: a, lines });
});

router.get('/accounting/vat', viewer, (req, res) => {
  res.json(vatReport(isMonth(req.query.month) ? req.query.month : today().slice(0, 7)));
});

router.get('/accounting/wht', viewer, (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? req.query.year : today().slice(0, 4);
  res.json(whtReport(year));
});

export default router;
