// การทำงานร่วมกันบนงานขาย: ผู้ถือหุ้นเลือก dev รับงาน และห้องคุยงานระหว่างพนักงานขายกับ dev
import { Router } from 'express';
import { q, notify } from '../db.js';
import { requireAuth, requireRole, seesAll } from '../auth.js';

const router = Router();
const assigner = requireRole('admin', 'shareholder'); // ผู้เลือก dev

// dev (สิทธิ์พนักงาน) พร้อมภาระงานปัจจุบัน เรียงคนว่างขึ้นก่อน
router.get('/dev-candidates', assigner, (_req, res) => {
  const devs = q.all("SELECT id, name, position, phone, avatar FROM users WHERE role = 'staff' AND active = 1 ORDER BY name").map((u) => {
    const deals = q.get("SELECT COUNT(*) AS n FROM deals WHERE dev_id = ? AND status NOT IN ('won', 'lost')", u.id).n;
    const tasks = q.get(
      "SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.assignee_id = ? AND t.status != 'done' AND p.status = 'active'",
      u.id,
    ).n;
    return { ...u, open_deals: deals, open_tasks: tasks, free: deals === 0 && tasks === 0 };
  });
  res.json(devs.sort((a, b) => (a.open_deals + a.open_tasks) - (b.open_deals + b.open_tasks)));
});

// ผู้ที่ร่วมงานขายนี้ได้: ผู้ที่ดูได้ทั้งหมด, พนักงานขายเจ้าของงาน และ dev ที่รับงาน
function findDealFor(req, res) {
  const deal = q.get('SELECT * FROM deals WHERE id = ?', req.params.id);
  if (!deal) return res.status(404).json({ error: 'ไม่พบงานขายนี้' }) && null;
  const ok = seesAll(req.user) || deal.sales_id === req.user.id || deal.dev_id === req.user.id;
  if (!ok) return res.status(403).json({ error: 'ไม่มีสิทธิ์ในงานขายนี้' }) && null;
  return deal;
}

// ผู้ถือหุ้น (หรือ admin) เลือก dev รับงาน — ส่ง dev_id ว่างเพื่อยกเลิก
router.put('/:id/dev', assigner, (req, res) => {
  const deal = findDealFor(req, res);
  if (!deal) return;
  const devId = req.body?.dev_id ? Number(req.body.dev_id) : null;
  const dev = devId ? q.get("SELECT id, name FROM users WHERE id = ? AND role = 'staff' AND active = 1", devId) : null;
  if (devId && !dev) return res.status(400).json({ error: 'ไม่พบ dev ที่เลือก' });
  q.run('UPDATE deals SET dev_id = ? WHERE id = ?', dev?.id ?? null, deal.id);

  if (dev && dev.id !== deal.dev_id) {
    const seller = q.get('SELECT name FROM users WHERE id = ?', deal.sales_id)?.name ?? '—';
    notify({ user_id: dev.id, title: `คุณได้รับมอบหมายงาน ${deal.code}`, body: `${deal.title} — คุยงานกับพนักงานขาย ${seller} และเตรียมหน้า Demo`, link: `/demos/${deal.id}` });
    if (deal.sales_id) {
      notify({ user_id: deal.sales_id, title: `${dev.name} รับงาน ${deal.code} แล้ว`, body: `${deal.title} — เริ่มคุยงานได้ที่แท็บ “คุยงานกับ dev”`, link: `/deals/${deal.id}` });
    }
  }
  res.json({ ok: true, dev_id: dev?.id ?? null, dev_name: dev?.name ?? null });
});

router.get('/:id/messages', requireAuth, (req, res) => {
  const deal = findDealFor(req, res);
  if (!deal) return;
  res.json(q.all(
    `SELECT m.id, m.body, m.created_at, m.user_id, u.name AS user_name, u.role AS user_role
     FROM deal_messages m JOIN users u ON u.id = m.user_id WHERE m.deal_id = ? ORDER BY m.id`,
    deal.id,
  ).map((m) => ({ ...m, mine: m.user_id === req.user.id })));
});

router.post('/:id/messages', requireAuth, (req, res) => {
  const deal = findDealFor(req, res);
  if (!deal) return;
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความ' });
  q.run('INSERT INTO deal_messages (deal_id, user_id, body) VALUES (?, ?, ?)', deal.id, req.user.id, body);

  // แจ้งคู่สนทนา: พนักงานขายและ dev ของงานนี้ (ยกเว้นผู้ส่ง)
  for (const uid of new Set([deal.sales_id, deal.dev_id])) {
    if (!uid || uid === req.user.id) continue;
    notify({
      user_id: uid, title: `ข้อความใหม่ในงาน ${deal.code} จาก ${req.user.name}`, body: body.slice(0, 140),
      link: uid === deal.dev_id && uid !== deal.sales_id ? `/demos/${deal.id}` : `/deals/${deal.id}`,
    });
  }
  res.status(201).json({ ok: true });
});

export default router;
