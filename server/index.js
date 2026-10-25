import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { attachUser, hashPassword } from './auth.js';
import adminRoutes from './routes/admin.js';
import dealRoutes, { documents } from './routes/deals.js';
import projectRoutes from './routes/projects.js';
import financeRoutes from './routes/finance.js';
import demoRoutes from './routes/demos.js';
import teamRoutes from './routes/teamwork.js';
import extraRoutes from './routes/extras.js';
import { startTimelineReminders } from './reminders.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist');

// ครั้งแรกที่รัน: สร้างบัญชีผู้ดูแลระบบจาก ADMIN_EMAIL / ADMIN_PASSWORD
if (!q.get('SELECT id FROM users LIMIT 1')) {
  const email = (process.env.ADMIN_EMAIL || 'admin@iterra.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'iterra-admin';
  q.run("INSERT INTO users (name, email, password_hash, role, position) VALUES ('ผู้ดูแลระบบ', ?, ?, 'admin', 'PM')", email, hashPassword(password));
  console.log(`สร้างบัญชีผู้ดูแลระบบ: ${email}${process.env.ADMIN_PASSWORD ? '' : ' / รหัสผ่านเริ่มต้น "iterra-admin" — กรุณาเปลี่ยนทันทีหลังเข้าสู่ระบบ'}`);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

// กัน CSRF: คำขอที่แก้ข้อมูลต้องมาจาก origin เดียวกัน
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  // ตอน dev คำขอผ่าน proxy ของ Vite ซึ่งส่ง host เดิมมาใน x-forwarded-host
  const hosts = [req.headers.host, req.headers['x-forwarded-host']];
  if (origin && !hosts.includes(new URL(origin).host)) return res.status(403).json({ error: 'คำขอมาจากแหล่งที่ไม่อนุญาต' });
  next();
});

app.use('/api', adminRoutes);
app.use('/api/deals', teamRoutes); // ต้องมาก่อน dealRoutes เพราะมีเส้นทาง /dev-candidates
app.use('/api/deals', extraRoutes); // งานเพิ่มเติมหลังปิดการขาย
app.use('/api/deals', dealRoutes);
app.use('/api/documents', documents);
app.use('/api/projects', projectRoutes);
app.use('/api/demos', demoRoutes);
app.use('/api', financeRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'ไม่พบ API นี้' }));

if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Iterra API พร้อมใช้งานที่ http://localhost:${port}`);
  startTimelineReminders(); // แจ้งเตือนทีมตามปฏิทินแผนงาน
});
