// สร้างบัญชีทีมงานตัวอย่าง (ฝ่ายขาย + ตำแหน่งหลัก) เพื่อทดลองระบบ: npm run seed:team
// รหัสผ่านกำหนดผ่าน TEAM_PASSWORD (อย่างน้อย 8 ตัวอักษร)
import { q } from './db.js';
import { hashPassword } from './auth.js';

const password = process.env.TEAM_PASSWORD;
if (!password || password.length < 8) {
  console.error('กรุณากำหนด TEAM_PASSWORD (อย่างน้อย 8 ตัวอักษร) เช่น TEAM_PASSWORD=xxxxxxxx npm run seed:team');
  process.exit(1);
}

const TEAM = [
  ['คุณฝ่ายขาย', 'sales@iterra.local', 'sales', null],
  ['คุณ PM', 'pm@iterra.local', 'staff', 'PM'],
  ['คุณ BA', 'ba@iterra.local', 'staff', 'BA'],
  ['คุณ SA', 'sa@iterra.local', 'staff', 'SA'],
  ['คุณ UX', 'ux@iterra.local', 'staff', 'UX'],
  ['คุณ Frontend', 'fe@iterra.local', 'staff', 'FE'],
  ['คุณ Backend', 'be@iterra.local', 'staff', 'BE'],
  ['คุณ QA', 'qa@iterra.local', 'staff', 'QA'],
  ['คุณ DevOps', 'devops@iterra.local', 'staff', 'DEVOPS'],
];

let added = 0;
for (const [name, email, role, position] of TEAM) {
  if (q.get('SELECT id FROM users WHERE email = ?', email)) continue;
  q.run('INSERT INTO users (name, email, password_hash, role, position) VALUES (?, ?, ?, ?, ?)', name, email, hashPassword(password), role, position);
  added++;
}
console.log(`เพิ่มผู้ใช้ ${added} คน (ข้ามอีเมลที่มีอยู่แล้ว ${TEAM.length - added} คน)`);
