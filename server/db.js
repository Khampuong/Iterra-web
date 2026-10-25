import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { POSITIONS } from './positions.js';
import { sendNotificationEmail, EMAIL_DEFAULTS } from './mailer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'iterra.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',        -- admin | sales | staff
  position TEXT,                             -- รหัสตำแหน่งงาน เช่น PM, FE
  phone TEXT,                                -- เบอร์โทรศัพท์ ตัวเลขไม่เกิน 10 หลัก
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_company TEXT, customer_email TEXT, customer_phone TEXT,
  customer_tax_id TEXT, customer_address TEXT,
  project_type TEXT,
  budget REAL, deadline TEXT,
  requirement TEXT NOT NULL DEFAULT '',          -- ข้อมูลเพิ่มเติม (ข้อความอิสระ)
  requirement_checks TEXT NOT NULL DEFAULT '[]', -- JSON รายการที่ติ๊กในเช็คลิสต์
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | analyzed | quoted | won | lost
  sales_id INTEGER REFERENCES users(id),
  analysis TEXT,                             -- JSON ผลวิเคราะห์
  demo_html TEXT, demo_source TEXT,
  demo_url TEXT,                             -- ลิงก์ Demo ที่ admin แนบให้พนักงานขายนำเสนอ
  demo_data TEXT,                            -- JSON ข้อมูลหน้า Demo ที่ทีมพัฒนาแก้ไข
  quote_note TEXT,                           -- หมายเหตุ / เงื่อนไขเพิ่มเติมที่แสดงในใบเสนอราคา
  step TEXT,                                 -- ขั้นตอนงานขายปัจจุบัน (รหัสจาก settings.sales_steps)
  duration_days INTEGER NOT NULL DEFAULT 0,  -- วันทำการ
  discount REAL NOT NULL DEFAULT 0,
  close_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS deal_items (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  effort TEXT NOT NULL DEFAULT '{}',         -- JSON { รหัสตำแหน่ง: man-day }
  price_override REAL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                        -- quotation | contract | invoice | receipt
  number TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  due_at TEXT,
  amount REAL NOT NULL DEFAULT 0,            -- ยอดรวม VAT
  status TEXT NOT NULL DEFAULT 'issued',     -- issued | paid | void
  ref_id INTEGER,                            -- ใบเสร็จอ้างถึงใบแจ้งหนี้
  data TEXT NOT NULL                         -- JSON snapshot ณ วันออกเอกสาร
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  customer TEXT,
  budget REAL NOT NULL DEFAULT 0,            -- มูลค่างานก่อน VAT
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',     -- active | done | hold
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_roles (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  days REAL NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,           -- สัดส่วนงาน
  share_percent REAL NOT NULL DEFAULT 0      -- สัดส่วนผลประโยชน์
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  title TEXT NOT NULL,
  position TEXT,
  assignee_id INTEGER REFERENCES users(id),
  start_date TEXT, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo',       -- todo | doing | review | done
  progress INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1             -- man-day ใช้ถ่วงน้ำหนักความคืบหน้า
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL,                        -- income | expense
  kind TEXT NOT NULL DEFAULT 'general',      -- general | payout (จ่ายส่วนแบ่ง)
  role_id INTEGER,                           -- project_roles.id เมื่อ kind = payout
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  document_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS timeline_items (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  type TEXT NOT NULL,            -- req | meet | dev | ops | server | test | perf | ship | mon
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deal_extras (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  no INTEGER NOT NULL,                       -- งานเพิ่มเติมลำดับที่ของงานขายนี้
  title TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',          -- JSON [{ title, description, effort, price_override }]
  discount REAL NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | quoted | approved | rejected
  quote_id INTEGER, invoice_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE TABLE IF NOT EXISTS deal_messages (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,                           -- NULL = ทุกคน
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// สัดส่วนผลประโยชน์ของพนักงานขายรายโครงการ (% ของมูลค่างาน) — NULL = ใช้ค่าจากหน้าตั้งค่า
if (!db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'sales_percent')) {
  db.exec('ALTER TABLE projects ADD COLUMN sales_percent REAL');
}

// คำนำและหมายเหตุของปฏิทินแผนงานรายโครงการ
for (const col of ['timeline_intro', 'timeline_note', 'timeline_title']) {
  if (!db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`);
}

// ฐานข้อมูลที่สร้างก่อนมีขั้นตอนงานขายแบบแก้ไขได้: เพิ่มคอลัมน์ให้
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'step')) {
  db.exec('ALTER TABLE deals ADD COLUMN step TEXT');
}

// dev ที่ผู้ถือหุ้นเลือกให้รับงานขายนี้
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'dev_id')) {
  db.exec('ALTER TABLE deals ADD COLUMN dev_id INTEGER REFERENCES users(id)');
}

// ราคาตั้งต้นของงานขาย (ก่อน VAT) ใช้คุมเพดานส่วนลดของพนักงานขาย
// ตั้งเมื่อวิเคราะห์ Requirement และเมื่อ admin/ผู้ถือหุ้นปรับราคา
// เวลาที่ dev กดรับงาน (ว่าง = ยังไม่กดรับ / เพิ่งถูกเลือก)
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'dev_accepted_at')) {
  db.exec('ALTER TABLE deals ADD COLUMN dev_accepted_at TEXT');
}

if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'price_base')) {
  db.exec('ALTER TABLE deals ADD COLUMN price_base REAL');
}

// หมายเหตุในใบเสนอราคา
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'quote_note')) {
  db.exec('ALTER TABLE deals ADD COLUMN quote_note TEXT');
}

// ฐานข้อมูลที่สร้างก่อนมีข้อมูลหน้า Demo ของทีมพัฒนา: เพิ่มคอลัมน์ให้
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'demo_data')) {
  db.exec('ALTER TABLE deals ADD COLUMN demo_data TEXT');
}

// ฐานข้อมูลที่สร้างก่อนมีลิงก์ Demo: เพิ่มคอลัมน์ให้
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'demo_url')) {
  db.exec('ALTER TABLE deals ADD COLUMN demo_url TEXT');
}

// ฐานข้อมูลที่สร้างก่อนมีเช็คลิสต์: เพิ่มคอลัมน์ให้
if (!db.prepare('PRAGMA table_info(deals)').all().some((c) => c.name === 'requirement_checks')) {
  db.exec("ALTER TABLE deals ADD COLUMN requirement_checks TEXT NOT NULL DEFAULT '[]'");
}

// ภาพสมาชิก: เก็บเป็น data URL ขนาดเล็ก (ย่อจากหน้าเว็บก่อนส่ง)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
}

// ฐานข้อมูลที่สร้างก่อนมีเบอร์โทรศัพท์สมาชิก: เพิ่มคอลัมน์ให้
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'phone')) {
  db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
}

// พนักงานขายที่ยังไม่มีตำแหน่ง ให้เป็นตำแหน่ง Sale
db.exec("UPDATE users SET position = 'SALE' WHERE role = 'sales' AND position IS NULL");

// ---------- helpers ----------
export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const DEFAULT_SETTINGS = {
  company: {
    name: 'Iterra Co., Ltd.',
    name_th: 'บริษัท อิเทอร์ร่า จำกัด',
    address: '180/75 ต.บางศรีเมือง อ.เมือง จ.นนทบุรี',
    tax_id: '',
    phone: '',
    email: '',
    signer: '',
  },
  rates: Object.fromEntries(POSITIONS.map((p) => [p.code, p.rate])),
  // max_sales_discount_percent: พนักงานขายลดราคาได้ไม่เกินกี่ % จากราคาตั้งต้น
  pricing: { margin_percent: 35, vat_percent: 7, quote_valid_days: 30, max_sales_discount_percent: 10 },
  payment_terms: [
    { label: 'งวดที่ 1 มัดจำเมื่อลงนามสัญญา', percent: 50 },
    { label: 'งวดที่ 2 เมื่อส่งมอบและตรวจรับงาน', percent: 50 },
  ],
  sharing: { sales_percent: 5, company_percent: 40 },
  // hours_per_day: ชั่วโมงทำงานต่อ 1 man-day (อัตราค่าแรงตั้งเป็นบาท/ชั่วโมง)
  capacity: { max_active_projects: 5, parallel_people: 3, buffer_percent: 15, hours_per_day: 8 },
  // ขั้นตอนงานขาย: draft / analyzed / quoted / won เป็นขั้นตอนของระบบ (แก้ชื่อได้ ลบไม่ได้)
  // admin เพิ่มขั้นตอนของตัวเองได้ (รหัสขึ้นต้นด้วย c_) โดย won ต้องอยู่ท้ายสุดเสมอ
  sales_steps: [
    { id: 'draft', label: 'รับ Requirement' },
    { id: 'analyzed', label: 'ประเมินราคา' },
    { id: 'quoted', label: 'เสนอราคา' },
    { id: 'won', label: 'ปิดการขาย' },
  ],
};

export const SYSTEM_STEPS = ['draft', 'analyzed', 'quoted', 'won'];

// รายการเช็คลิสต์ Requirement ที่ admin เพิ่มเอง: [{ id: 'x_...', title, desc, effort: { ตำแหน่ง: man-day } }]
DEFAULT_SETTINGS.requirement_items = [];

// การเชื่อมต่ออีเมลแจ้งเตือน (SMTP) — แก้ได้ที่หน้าตั้งค่า ค่าเริ่มต้นมาจาก .env
DEFAULT_SETTINGS.email = { ...EMAIL_DEFAULTS };

export function getSettings() {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const row of q.all('SELECT key, value FROM settings')) {
    const v = JSON.parse(row.value);
    out[row.key] = Array.isArray(v) ? v : { ...out[row.key], ...v };
  }
  return out;
}

// อัตราค่าแรงเดิมบันทึกเป็นบาท/man-day: แปลงเป็นบาท/ชั่วโมงครั้งเดียว (÷ ชั่วโมงต่อวัน)
if (db.prepare('PRAGMA user_version').get().user_version < 1) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'rates'").get();
  if (row) {
    const perDay = JSON.parse(row.value);
    const perHour = Object.fromEntries(Object.entries(perDay).map(([k, v]) => [k, Math.round((Number(v) / 8) * 100) / 100]));
    db.prepare("UPDATE settings SET value = ? WHERE key = 'rates'").run(JSON.stringify(perHour));
  }
  db.exec('PRAGMA user_version = 1');
}

export function setSetting(key, value) {
  q.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

// คีย์ลับสำหรับเซ็น session — ใช้ SESSION_SECRET ถ้ามี ไม่งั้นสร้างแล้วเก็บไว้ใน data/
export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

// แจ้งเตือนในระบบ และส่งอีเมลถึงผู้รับด้วย (ถ้าตั้งค่า SMTP ไว้)
export function notify({ user_id = null, title, body = '', link = '' }) {
  q.run('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', user_id, title, body, link);
  const user = user_id ? q.get('SELECT name, email FROM users WHERE id = ? AND active = 1', user_id) : null;
  if (user) sendNotificationEmail({ to: user.email, name: user.name, title, body, link });
}

// เลขรันเอกสาร/รหัส เช่น QT-2026-0001
export function nextCode(table, column, prefix) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = q.get(`SELECT ${column} AS c FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`, like);
  const n = row ? Number(row.c.split('-').pop()) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

// วันที่ตามเวลาเครื่อง (ไม่ใช่ UTC) รูปแบบ YYYY-MM-DD
export const today = () => new Date().toLocaleDateString('sv-SE');

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

export function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export function businessDaysBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(to + 'T00:00:00Z');
  let n = 0;
  while (a < b) {
    a.setUTCDate(a.getUTCDate() + 1);
    const wd = a.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
