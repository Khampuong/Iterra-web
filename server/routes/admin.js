import { Router } from 'express';
import { q, getSettings, setSetting, DEFAULT_SETTINGS, SYSTEM_STEPS } from '../db.js';
import { requireAuth, requireRole, hashPassword, verifyPassword, setSession, clearSession, publicUser } from '../auth.js';
import { GROUPS, PHASES, POSITIONS, POSITION_CODES, MEMBER_POSITIONS, MEMBER_POSITION_CODES } from '../positions.js';
import { requirementOptions, cleanEffort } from '../estimator.js';
import { emailEnabled } from '../mailer.js';

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
    groups: GROUPS, phases: PHASES, positions: POSITIONS, member_positions: MEMBER_POSITIONS,
    requirement_options: requirementOptions(),
    email_enabled: emailEnabled,
    sales_steps: getSettings().sales_steps,
    users: q.all('SELECT id, name, position, role FROM users WHERE active = 1 ORDER BY name'),
  });
});

// ---------- ตั้งค่า ----------
router.get('/settings', admin, (_req, res) => res.json(getSettings()));

router.put('/settings/:key', admin, (req, res) => {
  const { key } = req.params;
  if (!(key in DEFAULT_SETTINGS)) return res.status(404).json({ error: 'ไม่พบการตั้งค่านี้' });
  let value = req.body;

  if (key === 'requirement_items') {
    if (!Array.isArray(value)) return res.status(400).json({ error: 'รูปแบบรายการไม่ถูกต้อง' });
    if (value.length > 40) return res.status(400).json({ error: 'เพิ่มรายการเองได้ไม่เกิน 40 รายการ' });
    const seen = new Set();
    let n = 0;
    value = value.map((m) => {
      let id = /^x_[a-z0-9]{1,14}$/.test(String(m?.id || '')) ? m.id : '';
      while (!id || seen.has(id)) id = `x_${Date.now().toString(36)}${n++}`;
      seen.add(id);
      return { id, title: String(m?.title || '').trim().slice(0, 80), desc: String(m?.desc || '').trim().slice(0, 200), effort: cleanEffort(m?.effort) };
    });
    if (value.some((m) => !m.title)) return res.status(400).json({ error: 'กรุณาตั้งชื่อให้ครบทุกรายการ' });
    const noEffort = value.find((m) => !Object.keys(m.effort).length);
    if (noEffort) return res.status(400).json({ error: `รายการ “${noEffort.title}” ต้องมีกำลังคนอย่างน้อย 1 ตำแหน่ง เพื่อใช้คำนวณราคา` });
  } else if (key === 'sales_steps') {
    if (!Array.isArray(value)) return res.status(400).json({ error: 'รูปแบบขั้นตอนไม่ถูกต้อง' });
    if (value.length > 12) return res.status(400).json({ error: 'มีขั้นตอนได้ไม่เกิน 12 ขั้น' });
    const seen = new Set();
    let n = 0;
    value = value.map((s) => {
      let id = String(s?.id || '');
      // ขั้นตอนที่เพิ่มเอง: ใช้รหัสเดิมถ้าถูกรูปแบบ ไม่งั้นออกรหัสใหม่
      if (!SYSTEM_STEPS.includes(id) && !/^c_[a-z0-9]{1,12}$/.test(id)) id = '';
      while (!id || seen.has(id)) id = `c_${Date.now().toString(36)}${n++}`;
      seen.add(id);
      return { id, label: String(s?.label || '').trim().slice(0, 40) };
    });
    if (value.some((s) => !s.label)) return res.status(400).json({ error: 'กรุณาตั้งชื่อให้ครบทุกขั้นตอน' });
    if (SYSTEM_STEPS.some((id) => !seen.has(id))) return res.status(400).json({ error: 'ลบขั้นตอนของระบบไม่ได้ (รับ Requirement, ประเมินราคา, เสนอราคา, ปิดการขาย)' });
    const order = value.map((s) => s.id).filter((id) => SYSTEM_STEPS.includes(id));
    if (order.join() !== SYSTEM_STEPS.join()) return res.status(400).json({ error: 'ขั้นตอนของระบบต้องเรียงตามลำดับเดิม' });
    if (value[value.length - 1].id !== 'won') return res.status(400).json({ error: 'ขั้นตอนปิดการขายต้องอยู่ท้ายสุด' });
  } else if (key === 'payment_terms') {
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
// เบอร์โทรศัพท์สมาชิก: คืนตัวเลขล้วน, null ถ้าไม่กรอก, false ถ้าเกิน 10 หลัก
function cleanPhone(value) {
  if (value == null || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length > 10 ? false : digits || null;
}
const PHONE_ERROR = 'เบอร์โทรศัพท์ต้องเป็นตัวเลขไม่เกิน 10 หลัก';

router.get('/users', admin, (_req, res) => {
  res.json(q.all('SELECT id, name, email, phone, role, position, active, created_at FROM users ORDER BY active DESC, id'));
});

router.post('/users', admin, (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!b.name?.trim() || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'กรุณากรอกชื่อและอีเมลให้ถูกต้อง' });
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
  if (q.get('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'อีเมลนี้มีอยู่แล้ว' });
  const phone = cleanPhone(b.phone);
  if (phone === false) return res.status(400).json({ error: PHONE_ERROR });
  q.run(
    'INSERT INTO users (name, email, password_hash, role, position, phone) VALUES (?, ?, ?, ?, ?, ?)',
    b.name.trim(), email, hashPassword(b.password), ROLES.includes(b.role) ? b.role : 'staff',
    MEMBER_POSITION_CODES.includes(b.position) ? b.position : null, phone,
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
  const phone = 'phone' in b ? cleanPhone(b.phone) : u.phone;
  if (phone === false) return res.status(400).json({ error: PHONE_ERROR });
  q.run(
    'UPDATE users SET name = ?, role = ?, position = ?, active = ?, password_hash = ?, phone = ? WHERE id = ?',
    b.name?.trim() || u.name, role,
    'position' in b ? (MEMBER_POSITION_CODES.includes(b.position) ? b.position : null) : u.position,
    active, b.password ? hashPassword(b.password) : u.password_hash, phone, u.id,
  );
  res.json({ ok: true });
});

export default router;
