import crypto from 'node:crypto';
import { q, sessionSecret } from './db.js';

const COOKIE = 'iterra_session';
const MAX_AGE = 60 * 60 * 12; // 12 ชั่วโมง

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  return payload.exp > Date.now() / 1000 ? payload : null;
}

export function setSession(res, user) {
  const token = sign({ uid: user.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function publicUser(u) {
  return u && { id: u.id, name: u.name, email: u.email, role: u.role, position: u.position, phone: u.phone, active: u.active };
}

export function attachUser(req, _res, next) {
  const cookie = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  const payload = cookie && unsign(cookie.slice(COOKIE.length + 1));
  if (payload) {
    const user = q.get('SELECT * FROM users WHERE id = ? AND active = 1', payload.uid);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
}

// ผู้ถือหุ้นและกรรมการ: ดูข้อมูลได้ทั้งหมดแต่แก้ไขไม่ได้ · admin: ดูและแก้ไขได้ทั้งหมด
export const WIDE_ROLES = ['admin', 'shareholder', 'director'];
export const SELL_ROLES = ['admin', 'sales', 'staff'];
export const PROJECT_ROLES = ['admin', 'shareholder', 'director', 'staff']; // ฝ่ายขายดูโครงการไม่ได้
export const seesAll = (user) => WIDE_ROLES.includes(user.role);

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ทำรายการนี้' });
  next();
};
