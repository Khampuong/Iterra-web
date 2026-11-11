// แจ้งเตือนทีมตามปฏิทินแผนงานของโครงการ (timeline)
// ส่งให้ทุกคนในทีมของโครงการนั้น: ผู้รับผิดชอบตำแหน่งงาน + ผู้รับผิดชอบงาน (task)
import { q, notify, today, addDays } from './db.js';

// กันแจ้งซ้ำ: 1 รายการ 1 ชนิดการแจ้ง 1 ครั้ง (รายการในปฏิทินถูกบันทึกใหม่ทั้งชุด จึงใช้ข้อความ+วันเป็นกุญแจแทน id)
q.run(`CREATE TABLE IF NOT EXISTS timeline_reminders (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, key)
)`);

// ชื่อประเภทตรงกับหน้าปฏิทิน (client/src/components/ProjectCalendar.jsx)
export const TL_LABEL = { req: 'ข้อมูลที่ต้องได้จากลูกค้า', meet: 'นัดเข้าพบ', dev: 'พัฒนา', ops: 'ดำเนินการ', server: 'เซิร์ฟเวอร์', test: 'ทดสอบ', perf: 'ทดสอบ performance', ship: 'ส่งมอบ', mon: 'เฝ้าดูระบบ (monitor)' };

// สมาชิกที่ใช้งานอยู่ของทีมโครงการ
export function projectTeam(projectId) {
  return q.all(
    `SELECT DISTINCT u.id, u.name FROM users u
     WHERE u.active = 1 AND u.id IN (
       SELECT user_id FROM project_roles WHERE project_id = ? AND user_id IS NOT NULL
       UNION SELECT assignee_id FROM tasks WHERE project_id = ? AND assignee_id IS NOT NULL
     )`,
    projectId, projectId,
  );
}

export function notifyTeam(projectId, msg, exceptId = null) {
  const team = projectTeam(projectId).filter((u) => u.id !== exceptId);
  for (const u of team) notify({ user_id: u.id, link: `/projects/${projectId}?tab=calendar`, ...msg });
  return team.length;
}

// ตรวจปฏิทินของโครงการที่กำลังทำ: พรุ่งนี้เริ่ม / วันนี้เริ่ม / วันนี้ครบกำหนด
export function runTimelineReminders(now = today()) {
  const tomorrow = addDays(now, 1);
  const items = q.all(
    `SELECT t.*, p.code, p.name AS project_name FROM timeline_items t JOIN projects p ON p.id = t.project_id
     WHERE p.status = 'active' AND (t.start IN (?, ?) OR t.end = ?)`,
    now, tomorrow, now,
  );
  let sent = 0;
  for (const it of items) {
    const label = TL_LABEL[it.type] ?? it.type;
    const events = [];
    if (it.start === tomorrow) events.push(['start-tomorrow', `พรุ่งนี้เริ่ม: ${it.text}`]);
    if (it.start === now) events.push(['start-today', `วันนี้เริ่ม: ${it.text}`]);
    if (it.end === now && it.end !== it.start) events.push(['end-today', `วันนี้ครบกำหนด: ${it.text}`]);
    for (const [kind, title] of events) {
      const key = `${kind}|${it.start}|${it.end}|${it.text}`;
      const fresh = q.run('INSERT OR IGNORE INTO timeline_reminders (project_id, key) VALUES (?, ?)', it.project_id, key).changes;
      if (!fresh) continue;
      sent += notifyTeam(it.project_id, {
        title: `${it.code} · ${title}`,
        body: `${it.project_name} — ${label} · ${it.start === it.end ? it.start : `${it.start} ถึง ${it.end}`}`,
      });
    }
  }
  return sent;
}

// ตรวจตอนเปิดเซิร์ฟเวอร์และทุกชั่วโมง
export function startTimelineReminders() {
  const tick = () => {
    try {
      runTimelineReminders();
    } catch (e) {
      console.error('แจ้งเตือนปฏิทินไม่สำเร็จ:', e.message);
    }
  };
  tick();
  return setInterval(tick, 60 * 60 * 1000).unref();
}
