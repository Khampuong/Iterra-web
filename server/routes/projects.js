import { Router } from 'express';
import { q, tx, getSettings, nextCode, today, addBusinessDays, notify } from '../db.js';
import { PROJECT_ROLES, requireAuth, requireRole, seesAll } from '../auth.js';
import { effortByPosition } from '../estimator.js';
import { PHASES, POSITION_CODES, positionByCode } from '../positions.js';

const router = Router();
const admin = requireRole('admin');
router.use(requireRole(...PROJECT_ROLES));
const SALES_ROLE_ID = -1; // role_id ของรายการจ่ายค่าคอมมิชชันฝ่ายขาย

// เปิดโครงการจากงานขาย: แบ่ง % ตามตำแหน่ง, สร้างงานย่อยตามช่วงงาน, กำหนดวันตามระยะเวลา
export function createProjectFromDeal(deal, items, totals, start, end) {
  const code = nextCode('projects', 'code', 'PJ');
  const pid = Number(
    q.run(
      'INSERT INTO projects (deal_id, code, name, customer, budget, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      deal.id, code, deal.title, deal.customer_company || deal.customer_name, totals.net, start, end,
    ).lastInsertRowid,
  );

  const byPos = effortByPosition(items);
  const totalDays = Object.values(byPos).reduce((a, b) => a + b, 0) || 1;
  const userFor = (pos) => q.get('SELECT id FROM users WHERE position = ? AND active = 1 ORDER BY id LIMIT 1', pos)?.id ?? null;

  for (const code of POSITION_CODES) {
    if (!byPos[code]) continue;
    const pct = Math.round((byPos[code] / totalDays) * 1000) / 10;
    q.run(
      'INSERT INTO project_roles (project_id, position, user_id, days, percent, share_percent) VALUES (?, ?, ?, ?, ?, ?)',
      pid, code, userFor(code), byPos[code], pct, pct,
    );
  }

  // งานย่อย = รายการงาน × ตำแหน่ง โดย phase ตามตำแหน่ง
  // ยกเว้น PO/PM ที่ร่วมอยู่ในรายการของช่วงอื่น (เช่น คุม UAT) ให้ตาม phase หลักของรายการนั้น
  const planned = [];
  for (const it of items) {
    const byPhase = {};
    for (const [code, d] of Object.entries(it.effort)) {
      if (code !== 'PO' && code !== 'PM') byPhase[positionByCode[code].phase] = (byPhase[positionByCode[code].phase] || 0) + d;
    }
    const main = Object.entries(byPhase).sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const [code, d] of Object.entries(it.effort)) {
      const lead = code === 'PO' || code === 'PM';
      planned.push({ title: it.title, code, days: d, phase: lead && main ? main : positionByCode[code].phase });
    }
  }

  // แบ่งช่วงเวลาให้แต่ละ phase ตามสัดส่วน man-day
  const phaseDays = {};
  for (const t of planned) phaseDays[t.phase] = (phaseDays[t.phase] || 0) + t.days;
  const windows = {};
  let cursor = 0;
  for (const ph of PHASES) {
    if (!phaseDays[ph.id]) continue;
    const span = Math.max(1, Math.round((phaseDays[ph.id] / totalDays) * deal.duration_days));
    const from = Math.min(cursor, Math.max(0, deal.duration_days - 1));
    const to = Math.min(deal.duration_days, cursor + span);
    windows[ph.id] = { start: addBusinessDays(start, from), due: addBusinessDays(start, Math.max(to, from + 1)) };
    cursor = to;
  }
  // phase สุดท้ายที่มีงานให้จบตรงวันส่งมอบ
  const lastPhase = [...PHASES].reverse().find((p) => windows[p.id]);
  if (lastPhase) windows[lastPhase.id].due = end;

  for (const t of planned) {
    q.run(
      'INSERT INTO tasks (project_id, phase, title, position, assignee_id, start_date, due_date, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      pid, t.phase, t.title, t.code, userFor(t.code), windows[t.phase].start, windows[t.phase].due, t.days,
    );
  }

  const assignees = q.all('SELECT DISTINCT assignee_id AS id FROM tasks WHERE project_id = ? AND assignee_id IS NOT NULL', pid);
  for (const a of assignees) {
    notify({ user_id: a.id, title: `คุณได้รับมอบหมายงานในโครงการ ${code}`, body: deal.title, link: `/projects/${pid}` });
  }
  return pid;
}

function progressOf(tasks) {
  const w = tasks.reduce((s, t) => s + t.weight, 0);
  return w ? Math.round(tasks.reduce((s, t) => s + t.weight * t.progress, 0) / w) : 0;
}

export function projectSummary(p) {
  const tasks = q.all('SELECT * FROM tasks WHERE project_id = ?', p.id);
  const t = today();
  return {
    ...p,
    progress: progressOf(tasks),
    tasks_total: tasks.length,
    tasks_done: tasks.filter((x) => x.status === 'done').length,
    tasks_overdue: tasks.filter((x) => x.status !== 'done' && x.due_date && x.due_date < t).length,
  };
}

// แบ่งผลประโยชน์: มูลค่างาน - ต้นทุนตรง - คอมมิชชันฝ่ายขาย = ยอดจัดสรร -> บริษัท + ทีมตามสัดส่วน
export function computeSharing(project, settings = getSettings()) {
  const { company_percent } = settings.sharing;
  // พนักงานขาย: ใช้สัดส่วนที่ตั้งไว้ในโครงการ ถ้าไม่ได้ตั้งใช้ค่ากลางจากหน้าตั้งค่า
  const sales_percent = project.sales_percent ?? settings.sharing.sales_percent;
  const sum = (sql, ...p) => q.get(sql, ...p).s ?? 0;
  const received = sum("SELECT SUM(amount) AS s FROM transactions WHERE project_id = ? AND type = 'income'", project.id);
  const direct = sum("SELECT SUM(amount) AS s FROM transactions WHERE project_id = ? AND type = 'expense' AND kind = 'general'", project.id);
  const paidFor = (roleId) =>
    sum("SELECT SUM(amount) AS s FROM transactions WHERE project_id = ? AND kind = 'payout' AND role_id = ?", project.id, roleId);

  const revenue = project.budget;
  const sales = Math.round(revenue * sales_percent) / 100;
  const distributable = Math.max(0, revenue - direct - sales);
  const company = Math.round(distributable * company_percent) / 100;
  const pool = distributable - company;

  const roles = q.all(
    `SELECT r.*, u.name AS user_name FROM project_roles r LEFT JOIN users u ON u.id = r.user_id WHERE r.project_id = ? ORDER BY r.id`,
    project.id,
  );
  const shareTotal = roles.reduce((s, r) => s + r.share_percent, 0) || 1;
  const deal = project.deal_id ? q.get('SELECT sales_id FROM deals WHERE id = ?', project.deal_id) : null;
  const salesUser = deal?.sales_id ? q.get('SELECT id, name FROM users WHERE id = ?', deal.sales_id) : null;

  return {
    revenue, received, direct, distributable, company, pool,
    sales_percent, company_percent,
    sales: { role_id: SALES_ROLE_ID, user_id: salesUser?.id ?? null, user_name: salesUser?.name ?? null, amount: sales, paid: paidFor(SALES_ROLE_ID) },
    roles: roles.map((r) => {
      const amount = Math.round(((pool * r.share_percent) / shareTotal) * 100) / 100;
      return { ...r, share_normalized: Math.round((r.share_percent / shareTotal) * 1000) / 10, amount, paid: paidFor(r.id) };
    }),
  };
}

function findProject(req, res) {
  const p = q.get('SELECT * FROM projects WHERE id = ?', req.params.id);
  if (!p) res.status(404).json({ error: 'ไม่พบโครงการ' });
  return p;
}

// ทีมงาน (staff) ไม่เห็นมูลค่างาน
const forRole = (user, p) => (user.role === 'staff' ? { ...p, budget: undefined } : p);

router.get('/', requireAuth, (req, res) => {
  res.json(q.all('SELECT * FROM projects ORDER BY id DESC').map((p) => forRole(req.user, projectSummary(p))));
});

router.get('/:id', requireAuth, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const tasks = q.all(
    `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = ? ORDER BY t.start_date, t.id`,
    p.id,
  );
  const roles = q.all(
    `SELECT r.*, u.name AS user_name FROM project_roles r LEFT JOIN users u ON u.id = r.user_id WHERE r.project_id = ? ORDER BY r.id`,
    p.id,
  ).map((r) => ({ ...r, progress: progressOf(tasks.filter((t) => t.position === r.position)) }));
  const phases = PHASES.map((ph) => {
    const list = tasks.filter((t) => t.phase === ph.id);
    if (!list.length) return null;
    return {
      ...ph,
      start: list.reduce((m, t) => (t.start_date < m ? t.start_date : m), list[0].start_date),
      due: list.reduce((m, t) => (t.due_date > m ? t.due_date : m), list[0].due_date),
      progress: progressOf(list),
      days: list.reduce((s, t) => s + t.weight, 0),
    };
  }).filter(Boolean);
  // วันครบกำหนดชำระแต่ละงวด ใช้แสดงในปฏิทินแผนงาน (ไม่ส่งยอดเงิน)
  const milestones = p.deal_id
    ? q.all("SELECT number, due_at, status, data FROM documents WHERE deal_id = ? AND type = 'invoice' AND status != 'void' ORDER BY due_at", p.deal_id)
      .filter((inv) => inv.due_at)
      .map((inv) => ({ title: `ครบกำหนดชำระ ${JSON.parse(inv.data).installment?.label ?? inv.number}`, date: inv.due_at, status: inv.status }))
    : [];
  // ปฏิทินแผนงาน: items = null แปลว่ายังไม่เคยบันทึก (หน้าเว็บจะสร้างจากงานในระบบให้)
  const items = q.all('SELECT start, end, type, text FROM timeline_items WHERE project_id = ? ORDER BY start, sort, id', p.id);
  const timeline = { title: p.timeline_title ?? '', intro: p.timeline_intro ?? '', note: p.timeline_note ?? '', items: items.length ? items : null };
  const out = { ...forRole(req.user, projectSummary(p)), tasks, roles, phases, milestones, timeline };
  if (seesAll(req.user)) out.sharing = computeSharing(p);
  // พนักงานขายของโครงการ แสดงในตารางทีม (เปอร์เซ็นต์เห็นเฉพาะผู้ที่ดูผลประโยชน์ได้)
  const seller = p.deal_id ? q.get('SELECT u.name FROM deals d JOIN users u ON u.id = d.sales_id WHERE d.id = ?', p.deal_id) : null;
  out.sales = { user_name: seller?.name ?? null, percent: out.sharing ? out.sharing.sales_percent : null };
  res.json(out);
});

router.put('/:id', admin, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const b = req.body || {};
  q.run(
    'UPDATE projects SET name = ?, start_date = ?, end_date = ?, status = ? WHERE id = ?',
    b.name ?? p.name, b.start_date ?? p.start_date, b.end_date ?? p.end_date,
    ['active', 'done', 'hold'].includes(b.status) ? b.status : p.status, p.id,
  );
  res.json({ ok: true });
});

// ปรับทีม: ผู้รับผิดชอบ, % งาน และ % ผลประโยชน์ของแต่ละตำแหน่ง
router.put('/:id/roles', admin, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
  const salesPct = Number(req.body?.sales_percent);
  if ('sales_percent' in (req.body || {}) && !(salesPct >= 0 && salesPct <= 100)) {
    return res.status(400).json({ error: 'สัดส่วนพนักงานขายต้องอยู่ระหว่าง 0–100%' });
  }
  tx(() => {
    if ('sales_percent' in (req.body || {})) q.run('UPDATE projects SET sales_percent = ? WHERE id = ?', salesPct, p.id);
    for (const r of roles) {
      const row = q.get('SELECT * FROM project_roles WHERE id = ? AND project_id = ?', r.id, p.id);
      if (!row) continue;
      const uid = r.user_id ? Number(r.user_id) : null;
      q.run(
        'UPDATE project_roles SET user_id = ?, percent = ?, share_percent = ? WHERE id = ?',
        uid, Math.max(0, Number(r.percent) || 0), Math.max(0, Number(r.share_percent) || 0), row.id,
      );
      if (uid !== row.user_id) {
        // งานที่ยังไม่เสร็จของตำแหน่งนี้ย้ายไปผู้รับผิดชอบคนใหม่
        q.run("UPDATE tasks SET assignee_id = ? WHERE project_id = ? AND position = ? AND status != 'done'", uid, p.id, row.position);
        if (uid) notify({ user_id: uid, title: `คุณรับผิดชอบตำแหน่ง ${row.position} ในโครงการ ${p.code}`, body: p.name, link: `/projects/${p.id}` });
      }
    }
  });
  res.json({ ok: true });
});

// บันทึกปฏิทินแผนงานของโครงการ (แทนที่ทั้งชุด) · ส่ง items ว่างเพื่อกลับไปใช้รายการที่สร้างจากงานในระบบ
const TL_TYPES = ['req', 'meet', 'dev', 'ops', 'server', 'test', 'perf', 'ship', 'mon'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
router.put('/:id/timeline', admin, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length > 300) return res.status(400).json({ error: 'รายการในปฏิทินมากเกินไป (สูงสุด 300)' });
  const clean = [];
  for (const it of items) {
    const text = String(it?.text || '').trim().slice(0, 120);
    if (!text) continue; // แถวที่ไม่มีข้อความไม่บันทึก
    if (!isDate(it.start) || !isDate(it.end)) return res.status(400).json({ error: `กรุณาใส่วันเริ่มและวันสิ้นสุดของ “${text}”` });
    if (it.end < it.start) return res.status(400).json({ error: `วันสิ้นสุดของ “${text}” อยู่ก่อนวันเริ่ม` });
    clean.push({ start: it.start, end: it.end, type: TL_TYPES.includes(it.type) ? it.type : 'dev', text });
  }
  tx(() => {
    q.run('DELETE FROM timeline_items WHERE project_id = ?', p.id);
    clean.forEach((it, i) => q.run('INSERT INTO timeline_items (project_id, sort, start, end, type, text) VALUES (?, ?, ?, ?, ?, ?)', p.id, i, it.start, it.end, it.type, it.text));
    q.run(
      'UPDATE projects SET timeline_title = ?, timeline_intro = ?, timeline_note = ? WHERE id = ?',
      String(req.body?.title || '').trim().slice(0, 120), String(req.body?.intro || '').trim().slice(0, 600), String(req.body?.note || '').trim().slice(0, 2000), p.id,
    );
  });
  res.json({ ok: true, count: clean.length });
});

router.post('/:id/tasks', admin, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่องาน' });
  q.run(
    'INSERT INTO tasks (project_id, phase, title, position, assignee_id, start_date, due_date, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    p.id, PHASES.some((x) => x.id === b.phase) ? b.phase : 'development', b.title.trim(),
    POSITION_CODES.includes(b.position) ? b.position : null, b.assignee_id ? Number(b.assignee_id) : null,
    b.start_date || p.start_date, b.due_date || p.end_date, Math.max(0.5, Number(b.weight) || 1),
  );
  res.status(201).json({ ok: true });
});

// อัปเดตงาน: ผู้รับผิดชอบงานแก้สถานะ/ความคืบหน้าได้ ส่วนอื่นเฉพาะ admin
router.put('/:id/tasks/:taskId', requireAuth, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const t = q.get('SELECT * FROM tasks WHERE id = ? AND project_id = ?', req.params.taskId, p.id);
  if (!t) return res.status(404).json({ error: 'ไม่พบงาน' });
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && t.assignee_id !== req.user.id) return res.status(403).json({ error: 'แก้ไขได้เฉพาะงานของตนเอง' });

  const b = req.body || {};
  let status = ['todo', 'doing', 'review', 'done'].includes(b.status) ? b.status : t.status;
  let progress = b.progress != null ? Math.max(0, Math.min(100, Math.round(Number(b.progress) || 0))) : t.progress;
  if (b.status === 'done') progress = 100;
  else if (b.progress != null && progress === 100) status = 'done';
  else if (b.status && b.status !== 'done' && progress === 100) progress = 90;
  else if (status === 'todo' && progress > 0) status = 'doing';

  q.run(
    'UPDATE tasks SET phase = ?, position = ?, status = ?, progress = ?, assignee_id = ?, start_date = ?, due_date = ?, title = ?, weight = ? WHERE id = ?',
    isAdmin && PHASES.some((x) => x.id === b.phase) ? b.phase : t.phase,
    isAdmin && 'position' in b ? (POSITION_CODES.includes(b.position) ? b.position : null) : t.position,
    status, progress,
    isAdmin && 'assignee_id' in b ? (b.assignee_id ? Number(b.assignee_id) : null) : t.assignee_id,
    isAdmin && b.start_date ? b.start_date : t.start_date,
    isAdmin && b.due_date ? b.due_date : t.due_date,
    isAdmin && b.title?.trim() ? b.title.trim() : t.title,
    isAdmin && b.weight ? Math.max(0.5, Number(b.weight)) : t.weight, t.id,
  );

  const left = q.get("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status != 'done'", p.id).n;
  if (left === 0 && p.status === 'active') {
    q.run("UPDATE projects SET status = 'done' WHERE id = ?", p.id);
    for (const a of q.all("SELECT id FROM users WHERE role = 'admin' AND active = 1")) {
      notify({ user_id: a.id, title: `โครงการ ${p.code} เสร็จครบทุกงานแล้ว`, body: p.name, link: `/projects/${p.id}` });
    }
  } else if (left > 0 && p.status === 'done') {
    q.run("UPDATE projects SET status = 'active' WHERE id = ?", p.id);
  }
  res.json({ ok: true });
});

router.delete('/:id/tasks/:taskId', admin, (req, res) => {
  q.run('DELETE FROM tasks WHERE id = ? AND project_id = ?', req.params.taskId, req.params.id);
  res.json({ ok: true });
});

// บันทึกจ่ายส่วนแบ่งให้ตำแหน่ง/ฝ่ายขาย
router.post('/:id/payout', admin, (req, res) => {
  const p = findProject(req, res);
  if (!p) return;
  const amount = Number(req.body?.amount);
  const roleId = Number(req.body?.role_id);
  if (!(amount > 0)) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });
  const sharing = computeSharing(p);
  const target = roleId === SALES_ROLE_ID ? sharing.sales : sharing.roles.find((r) => r.id === roleId);
  if (!target) return res.status(404).json({ error: 'ไม่พบตำแหน่งที่จะจ่าย' });
  if (amount > target.amount - target.paid + 0.005) return res.status(400).json({ error: 'จำนวนเงินเกินส่วนแบ่งคงเหลือ' });
  const label = roleId === SALES_ROLE_ID ? 'ค่าคอมมิชชันฝ่ายขาย' : `ส่วนแบ่ง ${target.position}`;
  q.run(
    "INSERT INTO transactions (project_id, type, kind, role_id, category, amount, date, note) VALUES (?, 'expense', 'payout', ?, 'ส่วนแบ่งผลประโยชน์', ?, ?, ?)",
    p.id, roleId, amount, req.body?.date || today(), `${label}${target.user_name ? ` — ${target.user_name}` : ''}`,
  );
  if (target.user_id) notify({ user_id: target.user_id, title: `บันทึกจ่ายส่วนแบ่งโครงการ ${p.code}`, body: `${amount.toLocaleString('th-TH')} บาท`, link: '' });
  res.json({ ok: true });
});

export default router;
