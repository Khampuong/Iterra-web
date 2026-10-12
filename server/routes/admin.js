import { Router } from 'express';
import { q, getSettings, setSetting, DEFAULT_SETTINGS } from '../db.js';
import { requireAuth, requireRole, hashPassword, verifyPassword, setSession, clearSession, publicUser } from '../auth.js';
import { GROUPS, PHASES, POSITIONS, POSITION_CODES } from '../positions.js';
import { REQUIREMENT_OPTIONS } from '../estimator.js';

const router = Router();
const admin = requireRole('admin');
const ROLES = ['admin', 'shareholder', 'director', 'sales', 'staff'];

// ---------- เข้าสู่ระบบ ----------
const attempts = new Map(); // กันเดารหัสผ่าน: จำกัด 8 ครั้ง / 10 นาที ต่ออีเมล

router.post('/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const now = Date.now();
  const rec = attempts.get(email) ?? { n: 0, until: now + 600_000 };
  if (rec.until < now) { rec.n = 0; rec.until = now + 600_000; }
  if (rec.n >= 8) return res.status(429).json({ error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 10 นาที' });

  const user = q.get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    rec.n++;
    attempts.set(email, rec);
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  attempts.delete(email);
  setSession(res, user);
  res.json(publicUser(user));
});

router.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => res.json(publicUser(req.user) ?? null));

router.put('/auth/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(String(current || ''), req.user.password_hash)) return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// ---------- ข้อมูลอ้างอิง ----------
router.get('/meta', requireAuth, (_req, res) => {
  res.json({
    groups: GROUPS, phases: PHASES, positions: POSITIONS,
    requirement_options: REQUIREMENT_OPTIONS,
    users: q.all('SELECT id, name, position, role FROM users WHERE active = 1 ORDER BY name'),
  });
});

// ---------- ตั้งค่า ----------
router.get('/settings', admin, (_req, res) => res.json(getSettings()));

router.put('/settings/:key', admin, (req, res) => {
  const { key } = req.params;
  if (!(key in DEFAULT_SETTINGS)) return res.status(404).json({ error: 'ไม่พบการตั้งค่านี้' });
  let value = req.body;

  if (key === 'payment_terms') {
    if (!Array.isArray(value) || !value.length) return res.status(400).json({ error: 'ต้องมีอย่างน้อย 1 งวด' });
    value = value.map((t) => ({ label: String(t.label || '').trim() || 'งวดชำระ', percent: Number(t.percent) || 0 }));
    const total = value.reduce((s, t) => s + t.percent, 0);
    if (Math.abs(total - 100) > 0.01) return res.status(400).json({ error: `สัดส่วนงวดชำระรวมต้องเท่ากับ 100% (ตอนนี้ ${total}%)` });
  } else if (key === 'company') {
    value = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.company).map((k) => [k, String(value?.[k] ?? '')]));
  } else {
    // ที่เหลือเป็นตัวเลขล้วน
    const keys = key === 'rates' ? POSITION_CODES : Object.keys(DEFAULT_SETTINGS[key]);
    value = Object.fromEntries(keys.map((k) => [k, Math.max(0, Number(value?.[k]) || 0)]));
    if (key === 'sharing' && value.sales_percent + value.company_percent > 100) {
      return res.status(400).json({ error: 'สัดส่วนฝ่ายขายและบริษัทรวมกันเกิน 100%' });
    }
  }
  setSetting(key, value);
  res.json(getSettings());
});

// ---------- ผู้ใช้ ----------
router.get('/users', admin, (_req, res) => {
  res.json(q.all('SELECT id, name, email, role, position, active, created_at FROM users ORDER BY active DESC, id'));
});

router.post('/users', admin, (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!b.name?.trim() || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'กรุณากรอกชื่อและอีเมลให้ถูกต้อง' });
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
  if (q.get('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'อีเมลนี้มีอยู่แล้ว' });
  q.run(
    'INSERT INTO users (name, email, password_hash, role, position) VALUES (?, ?, ?, ?, ?)',
    b.name.trim(), email, hashPassword(b.password), ROLES.includes(b.role) ? b.role : 'staff',
    POSITION_CODES.includes(b.position) ? b.position : null,
  );
  res.status(201).json({ ok: true });
});

router.put('/users/:id', admin, (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const b = req.body || {};
  const role = ROLES.includes(b.role) ? b.role : u.role;
  const active = 'active' in b ? (b.active ? 1 : 0) : u.active;
  if (u.role === 'admin' && (role !== 'admin' || !active)) {
    const others = q.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", u.id).n;
    if (!others) return res.status(409).json({ error: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน' });
  }
  if (b.password && String(b.password).length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
  q.run(
    'UPDATE users SET name = ?, role = ?, position = ?, active = ?, password_hash = ? WHERE id = ?',
    b.name?.trim() || u.name, role,
    'position' in b ? (POSITION_CODES.includes(b.position) ? b.position : null) : u.position,
    active, b.password ? hashPassword(b.password) : u.password_hash, u.id,
  );
  res.json({ ok: true });
});

export default router;
