// ส่งการแจ้งเตือนทางอีเมลควบคู่กับการแจ้งเตือนในระบบ
// เปิดใช้เมื่อกำหนด SMTP_HOST ใน .env — ถ้าไม่กำหนด ระบบจะแจ้งเตือนในระบบอย่างเดียว
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, MAIL_FROM, APP_URL } = process.env;

export const emailEnabled = Boolean(SMTP_HOST);

const transport = emailEnabled
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const baseUrl = (APP_URL || 'http://localhost:4000').replace(/\/+$/, '');

// ส่งแบบไม่รอผล: อีเมลล่มต้องไม่ทำให้งานหลักของผู้ใช้ล้ม
export function sendNotificationEmail({ to, name, title, body, link }) {
  if (!transport || !to) return;
  const url = link ? baseUrl + link : baseUrl;
  transport
    .sendMail({
      from: MAIL_FROM || SMTP_USER || 'Iterra <no-reply@localhost>',
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
    })
    .catch((err) => console.error(`ส่งอีเมลแจ้งเตือนถึง ${to} ไม่สำเร็จ:`, err.message));
}
