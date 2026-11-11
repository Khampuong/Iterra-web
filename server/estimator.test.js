// ทดสอบการเลือกตำแหน่งที่เกี่ยวข้องกับงาน: ใส่เฉพาะตำแหน่งที่งานต้องใช้ ไม่ใส่ทุกตำแหน่ง
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iterra-est-'));
const E = await import('./estimator.js');

const plan = (checks, requirement = '') => {
  const r = E.fallbackAnalyze({ title: 'งานทดสอบ', requirement, requirement_checks: JSON.stringify(checks) });
  return { ...r, roles: E.summarizeRoles(r.items, r.role_reasons).map((x) => x.code) };
};

test('เว็บไซต์เล็ก: ไม่มี Architect / BA / SA / DBA / Mobile / Security', () => {
  const { roles } = plan(['cms']);
  for (const code of ['ARCH', 'BA', 'SA', 'DBA', 'MOBILE', 'SEC', 'PO', 'LEAD']) assert.ok(!roles.includes(code), `ไม่ควรมี ${code}`);
  for (const code of ['PM', 'UX', 'FE', 'BE']) assert.ok(roles.includes(code), `ต้องมี ${code}`);
  assert.ok(roles.length < 17);
});

test('ระบบ ERP + API + มือถือ: มี BA และ Architect เพราะงานซับซ้อน', () => {
  const { roles, role_reasons: why } = plan(['erp', 'api', 'mobile']);
  for (const code of ['BA', 'ARCH', 'MOBILE', 'DBA']) assert.ok(roles.includes(code), `ต้องมี ${code}`);
  assert.match(why.ARCH, /สถาปัตยกรรม/);
});

test('ระบบชำระเงิน: มี Security เพราะเกี่ยวกับการเงิน', () => {
  assert.ok(plan(['cms', 'payment']).roles.includes('SEC'));
});

test('เลือกขึ้น Server เอง: ไม่คิด DevOps ซ้ำในขั้นนำขึ้นใช้งาน / เลือก Service: ไม่คิดส่งมอบซ้ำ', () => {
  const { items } = plan(['cms', 'hosting', 'service']);
  assert.ok(!items.some((i) => i.title === 'นำขึ้นใช้งานและส่งมอบ'));
});

test('ทุกตำแหน่งในรายการงานมีเหตุผลกำกับ', () => {
  const r = E.fallbackAnalyze({ title: 'x', requirement: '', requirement_checks: JSON.stringify(['shop', 'member', 'dashboard']) });
  for (const role of E.summarizeRoles(r.items, r.role_reasons)) assert.ok(role.reason && role.days > 0, role.code);
});
