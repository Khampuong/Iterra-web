// ตัวช่วยเรียก API และจัดรูปแบบข้อมูล
async function request(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};

const nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n) => nf0.format(Math.round(Number(n) || 0));
export const money = (n) => `฿${num(n)}`;
export const money2 = (n) => nf2.format(Number(n) || 0);

export function compact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

export function date(s) {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function dateLong(s) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short' });
}

// เบอร์โทรศัพท์: เก็บเฉพาะตัวเลข ไม่เกิน 10 หลัก
export const phoneDigits = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 10);

export const todayStr =() => new Date().toLocaleDateString('sv-SE');

export const DEAL_STATUS = {
  draft: { label: 'ร่าง', tone: '' },
  analyzed: { label: 'วิเคราะห์แล้ว', tone: 'blue' },
  quoted: { label: 'เสนอราคาแล้ว', tone: 'warn' },
  won: { label: 'ปิดการขาย', tone: 'ok' },
  lost: { label: 'ไม่ได้งาน', tone: 'danger' },
};
export const PROJECT_STATUS = {
  active: { label: 'กำลังดำเนินการ', tone: 'blue' },
  done: { label: 'เสร็จสิ้น', tone: 'ok' },
  hold: { label: 'พักโครงการ', tone: 'warn' },
};
export const TASK_STATUS = { todo: 'รอเริ่ม', doing: 'กำลังทำ', review: 'รอตรวจ', done: 'เสร็จ' };
export const DOC_TYPE = { quotation: 'ใบเสนอราคา', contract: 'สัญญาจ้างพัฒนาระบบ', invoice: 'ใบแจ้งหนี้', receipt: 'ใบเสร็จรับเงิน' };
export const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', shareholder: 'ผู้ถือหุ้น', director: 'กรรมการ', sales: 'พนักงานขาย', staff: 'พนักงาน' };
// สิทธิ์ตามบทบาท (ต้องตรงกับ server/auth.js)
export const WIDE = ['admin', 'shareholder', 'director']; // ดูได้ทั้งหมด
export const SELL = ['admin', 'sales', 'staff']; // ขายงานได้
export const PROJECTS = ['admin', 'shareholder', 'director', 'staff']; // ดูโครงการได้ (ฝ่ายขายดูไม่ได้)
export const ALL_ROLES = Object.keys(ROLE_LABEL);
// ทีมพัฒนา (dev) = สมาชิกสิทธิ์พนักงานทุกตำแหน่ง และ admin แก้ไขหน้า Demo ได้ (ต้องตรงกับ server/auth.js)
export const canEditDemo = (user) => user.role === 'admin' || user.role === 'staff';
export const homeFor = (role) => (role === 'sales' ? '/deals' : '/');

// จำนวนเงินเป็นตัวอักษรไทย เช่น "หนึ่งร้อยบาทถ้วน"
export function bahtText(amount) {
  const digits = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const read = (n) => {
    if (n === 0) return '';
    if (n >= 1e6) return read(Math.floor(n / 1e6)) + 'ล้าน' + read(n % 1e6);
    const s = String(n);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = Number(s[i]);
      const p = s.length - i - 1;
      if (d === 0) continue;
      if (p === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
      else if (p === 1 && d === 2) out += 'ยี่สิบ';
      else if (p === 1 && d === 1) out += 'สิบ';
      else out += digits[d] + places[p];
    }
    return out;
  };
  const fixed = (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2);
  const [b, s] = fixed.split('.').map(Number);
  const baht = b === 0 ? 'ศูนย์' : read(b);
  return s === 0 ? `${baht}บาทถ้วน` : `${baht}บาท${read(s)}สตางค์`;
}
