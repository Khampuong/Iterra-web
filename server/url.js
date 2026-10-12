// ตรวจลิงก์ที่ผู้ใช้กรอก: รับเฉพาะ http/https, เติม https:// ให้ถ้าไม่ได้ใส่
// คืน { url } (null = ไม่ได้กรอก) หรือ { error }
export function cleanHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { url: null };
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error('bad url');
    return { url: u.href };
  } catch {
    return { error: 'ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย http:// หรือ https://' };
  }
}
