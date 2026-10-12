import { Router } from 'express';
import { q, getSettings, today, businessDaysBetween } from '../db.js';
import { requireAuth, requireRole, seesAll, WIDE_ROLES } from '../auth.js';
import { priceItem, dealTotals } from '../estimator.js';
import { computeSharing, projectSummary } from './projects.js';

const router = Router();
const admin = requireRole('admin');
const viewer = requireRole(...WIDE_ROLES); // ดูการเงินและผลประโยชน์ได้

const sum = (sql, ...p) => q.get(sql, ...p).s ?? 0;

function lastMonths(n) {
  const out = [];
  const [y, mo] = today().split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(y, mo - 1 - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

function monthly(n) {
  return lastMonths(n).map((month) => ({
    month,
    income: sum("SELECT SUM(amount) AS s FROM transactions WHERE type = 'income' AND substr(date, 1, 7) = ?", month),
    expense: sum("SELECT SUM(amount) AS s FROM transactions WHERE type = 'expense' AND substr(date, 1, 7) = ?", month),
  }));
}

// ---------- รายรับรายจ่าย ----------
router.get('/transactions', viewer, (req, res) => {
  const where = [];
  const params = [];
  if (req.query.month) { where.push('substr(t.date, 1, 7) = ?'); params.push(req.query.month); }
  if (req.query.project_id) { where.push('t.project_id = ?'); params.push(req.query.project_id); }
  if (req.query.type) { where.push('t.type = ?'); params.push(req.query.type); }
  res.json(q.all(
    `SELECT t.*, p.code AS project_code, p.name AS project_name FROM transactions t
     LEFT JOIN projects p ON p.id = t.project_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.date DESC, t.id DESC LIMIT 500`,
    ...params,
  ));
});

router.post('/transactions', admin, (req, res) => {
  const b = req.body || {};
  const amount = Number(b.amount);
  if (!['income', 'expense'].includes(b.type) || !(amount > 0) || !b.category?.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกประเภท หมวด และจำนวนเงินให้ครบ' });
  }
  q.run(
    'INSERT INTO transactions (project_id, type, category, amount, date, note) VALUES (?, ?, ?, ?, ?, ?)',
    b.project_id ? Number(b.project_id) : null, b.type, b.category.trim(), amount, b.date || today(), b.note || null,
  );
  res.status(201).json({ ok: true });
});

router.delete('/transactions/:id', admin, (req, res) => {
  const t = q.get('SELECT * FROM transactions WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (t.document_id) return res.status(409).json({ error: 'รายการนี้ผูกกับใบเสร็จรับเงิน ลบไม่ได้' });
  q.run('DELETE FROM transactions WHERE id = ?', t.id);
  res.json({ ok: true });
});

router.get('/finance/summary', viewer, (_req, res) => {
  const income = sum("SELECT SUM(amount) AS s FROM transactions WHERE type = 'income'");
  const expense = sum("SELECT SUM(amount) AS s FROM transactions WHERE type = 'expense'");
  const receivable = q.all("SELECT data FROM documents WHERE type = 'invoice' AND status = 'issued'")
    .reduce((s, d) => s + JSON.parse(d.data).installment.net, 0);
  res.json({
    income, expense, net: income - expense, receivable,
    monthly: monthly(12),
    categories: q.all('SELECT type, category, SUM(amount) AS amount FROM transactions GROUP BY type, category ORDER BY amount DESC'),
    projects: q.all('SELECT * FROM projects ORDER BY id DESC').map((p) => {
      const inc = sum("SELECT SUM(amount) AS s FROM transactions WHERE project_id = ? AND type = 'income'", p.id);
      const exp = sum("SELECT SUM(amount) AS s FROM transactions WHERE project_id = ? AND type = 'expense'", p.id);
      return { id: p.id, code: p.code, name: p.name, budget: p.budget, income: inc, expense: exp, net: inc - exp };
    }),
  });
});

// ---------- แบ่งผลประโยชน์ (ภาพรวมทุกโครงการ) ----------
router.get('/sharing', viewer, (_req, res) => {
  const settings = getSettings();
  const projects = q.all('SELECT * FROM projects ORDER BY id DESC').map((p) => ({
    id: p.id, code: p.code, name: p.name, status: p.status, ...computeSharing(p, settings),
  }));
  const people = new Map();
  const add = (key, name, position, amount, paid) => {
    const row = people.get(key) ?? { name, positions: new Set(), amount: 0, paid: 0, projects: 0 };
    row.positions.add(position);
    row.amount += amount;
    row.paid += paid;
    row.projects += 1;
    people.set(key, row);
  };
  for (const p of projects) {
    add(p.sales.user_id ? `u${p.sales.user_id}` : 'sales', p.sales.user_name ?? 'ฝ่ายขาย (ยังไม่ระบุ)', 'Sales', p.sales.amount, p.sales.paid);
    for (const r of p.roles) add(r.user_id ? `u${r.user_id}` : `pos-${r.position}`, r.user_name ?? `${r.position} (ยังไม่ระบุคน)`, r.position, r.amount, r.paid);
  }
  res.json({
    settings: settings.sharing,
    projects,
    people: [...people.values()].map((r) => ({ ...r, positions: [...r.positions] })).sort((a, b) => b.amount - a.amount),
  });
});

// ---------- Dashboard ----------
// ฝ่ายขายไม่มีสิทธิ์ดู Dashboard
router.get('/dashboard', requireRole(...WIDE_ROLES, 'staff'), (req, res) => {
  const settings = getSettings();
  const isAdmin = seesAll(req.user);
  const t = today();

  const deals = isAdmin ? q.all('SELECT * FROM deals') : q.all('SELECT * FROM deals WHERE sales_id = ?', req.user.id);
  const pipeline = ['draft', 'analyzed', 'quoted', 'won', 'lost'].map((status) => {
    const list = deals.filter((d) => d.status === status);
    const value = list.reduce((s, d) => {
      const items = q.all('SELECT * FROM deal_items WHERE deal_id = ?', d.id).map((i) => priceItem(i, settings));
      return s + dealTotals(items, d, settings).net;
    }, 0);
    return { status, count: list.length, value };
  });
  const closed = pipeline[3].count + pipeline[4].count;

  const projects = q.all('SELECT * FROM projects ORDER BY end_date').map(projectSummary);
  const active = projects.filter((p) => p.status === 'active');

  const myTasks = q.all(
    `SELECT t.id, t.title, t.position, t.due_date, t.status, t.progress, p.id AS project_id, p.code AS project_code
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.status != 'done' AND p.status = 'active' ${isAdmin ? '' : 'AND t.assignee_id = ?'}
     ORDER BY t.due_date LIMIT 8`,
    ...(isAdmin ? [] : [req.user.id]),
  );

  const out = {
    pipeline,
    win_rate: closed ? Math.round((pipeline[3].count / closed) * 100) : null,
    open_value: pipeline.slice(0, 3).reduce((s, x) => s + x.value, 0),
    projects: active.map((p) => ({
      id: p.id, code: p.code, name: p.name, customer: p.customer, progress: p.progress, end_date: p.end_date,
      tasks_overdue: p.tasks_overdue, days_left: p.end_date >= t ? businessDaysBetween(t, p.end_date) : -businessDaysBetween(p.end_date, t),
    })),
    counts: { active: active.length, done: projects.filter((p) => p.status === 'done').length, overdue_tasks: active.reduce((s, p) => s + p.tasks_overdue, 0) },
    tasks: myTasks,
  };

  if (isAdmin) {
    const month = t.slice(0, 7);
    const income = sum("SELECT SUM(amount) AS s FROM transactions WHERE type = 'income' AND substr(date, 1, 7) = ?", month);
    const expense = sum("SELECT SUM(amount) AS s FROM transactions WHERE type = 'expense' AND substr(date, 1, 7) = ?", month);
    out.finance = {
      month, income, expense, net: income - expense,
      total_net: sum("SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS s FROM transactions"),
      receivable: q.all("SELECT data FROM documents WHERE type = 'invoice' AND status = 'issued'")
        .reduce((s, d) => s + JSON.parse(d.data).installment.net, 0),
      monthly: monthly(6),
    };
  }
  res.json(out);
});

// ---------- การแจ้งเตือน ----------
router.get('/notifications', requireAuth, (req, res) => {
  const t = today();
  const isAdmin = seesAll(req.user);
  const alerts = [];

  const tasks = q.all(
    `SELECT t.id, t.title, t.position, t.due_date, p.id AS project_id, p.code FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.status != 'done' AND p.status = 'active' AND t.due_date IS NOT NULL ${isAdmin ? '' : 'AND t.assignee_id = ?'}
     ORDER BY t.due_date`,
    ...(isAdmin ? [] : [req.user.id]),
  );
  for (const x of tasks) {
    const left = x.due_date >= t ? businessDaysBetween(t, x.due_date) : -1;
    if (left < 0) alerts.push({ level: 'danger', title: `เลยกำหนด: ${x.title}`, body: `${x.code} · ${x.position ?? ''} · ครบกำหนด ${x.due_date}`, link: `/projects/${x.project_id}` });
    else if (left <= 3) alerts.push({ level: 'warn', title: `ใกล้ครบกำหนด: ${x.title}`, body: `${x.code} · ${x.position ?? ''} · เหลือ ${left} วันทำการ`, link: `/projects/${x.project_id}` });
  }

  {
    const invoices = q.all(
      `SELECT d.number, d.due_at, d.deal_id, dl.title FROM documents d JOIN deals dl ON dl.id = d.deal_id
       WHERE d.type = 'invoice' AND d.status = 'issued' AND d.due_at <= ? ${isAdmin ? '' : 'AND dl.sales_id = ?'}`,
      t, ...(isAdmin ? [] : [req.user.id]),
    );
    for (const inv of invoices) {
      alerts.push({ level: 'danger', title: `ใบแจ้งหนี้ ${inv.number} ครบกำหนดชำระ`, body: `${inv.title} · ครบกำหนด ${inv.due_at}`, link: `/deals/${inv.deal_id}` });
    }
  }

  const events = q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.user.id);
  res.json({ alerts: alerts.slice(0, 30), events, unread: events.filter((e) => !e.read).length + alerts.length });
});

router.post('/notifications/read', requireAuth, (req, res) => {
  q.run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

export default router;
