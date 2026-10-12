// ส่งการแจ้งเตือนทางอีเมลถึงสมาชิก ควบคู่กับการแจ้งเตือนในระบบ
// ค่าเชื่อมต่อ SMTP ตั้งได้ที่หน้า ตั้งค่า → อีเมลแจ้งเตือน (ค่าเริ่มต้นอ่านจาก .env)
import nodemailer from 'nodemailer';
import { getSettings } from './db.js';

// ค่าเริ่มต้นจาก .env ใช้เมื่อยังไม่ได้ตั้งค่าในระบบ
export const EMAIL_DEFAULTS = {
  enabled: Boolean(process.env.SMTP_HOST),
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || '',
  app_url: process.env.APP_URL || 'http://localhost:5173',
};

export function emailConfig() {
  const c = getSettings().email;
  return { ...c, enabled: Boolean(c.enabled && c.host) };
}

// สร้าง transport ใหม่เมื่อค่าตั้งเปลี่ยนเท่านั้น
let cached = { key: '', transport: null };
function transportFor(c) {
  const key = JSON.stringify([c.host, c.port, c.user, c.pass]);
  if (cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: c.host,
        port: Number(c.port) || 587,
        secure: Number(c.port) === 465, // พอร์ต 465 ใช้ SSL ตั้งแต่ต้น พอร์ตอื่นใช้ STARTTLS ถ้าเซิร์ฟเวอร์รองรับ
        auth: c.user ? { user: c.user, pass: c.pass } : undefined,
        connectionTimeout: 15_000,
      }),
    };
  }
  return cached.transport;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// ส่งอีเมล 1 ฉบับและรอผล (โยน error ถ้าส่งไม่สำเร็จ) — c = ค่าตั้งที่จะใช้ส่ง
export function sendMail(c, { to, name, title, body, link }) {
  const url = (c.app_url || 'http://localhost:5173').replace(/\/+$/, '') + (link || '');
  return transportFor(c).sendMail({
    from: c.from || c.user || 'Iterra <no-reply@localhost>',
    to,
    subject: `[Iterra] ${title}`,
    text: `เรียน ${name}\n\n${title}\n${body || ''}\n\nเปิดในระบบ: ${url}\n\n— ระบบ Iterra (อีเมลอัตโนมัติ)`,
    html: `<div style="font-family:Tahoma,sans-serif;color:#0d1b34;max-width:520px">
<p style="color:#46546b">เรียน ${esc(name)}</p>
<h2 style="font-size:18px;margin:0 0 6px">${esc(title)}</h2>
<p style="margin:0 0 18px;color:#46546b">${esc(body)}</p>
<p><a href="${esc(url)}" style="background:#1f62c4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">เปิดในระบบ</a></p>
<p style="color:#8792a6;font-size:12px;margin-top:24px">ระบบ Iterra — อีเมลอัตโนมัติ กรุณาอย่าตอบกลับ</p>
</div>`,
  });
}

// ส่งการแจ้งเตือนแบบไม่รอผล: อีเมลล่มต้องไม่ทำให้งานหลักของผู้ใช้ล้ม
export function sendNotificationEmail(mail) {
  const c = emailConfig();
  if (!c.enabled || !mail.to) return;
  sendMail(c, mail).catch((err) => console.error(`ส่งอีเมลแจ้งเตือนถึง ${mail.to} ไม่สำเร็จ:`, err.message));
}
