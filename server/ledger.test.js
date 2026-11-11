// ทดสอบสมุดบัญชี: ทุกเส้นทางการบันทึกต้อง Dr = Cr และตัวเลขตรงกับตัวอย่างงาน 1 ล้านบาทในเอกสารผังบัญชี
// รัน: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iterra-ledger-'));
const { q, db } = await import('./db.js');
const L = await import('./ledger.js');

// ใบแจ้งหนี้จำลอง งวดที่ 1: 300,000 + VAT 21,000
function invoice() {
  const deal = q.run("INSERT INTO deals (code, title, customer_name) VALUES (?, 'งาน 1 ล้านบาท', 'ลูกค้า')", `DL-T-${Date.now()}-${Math.random()}`);
  const data = { customer: { name: 'ลูกค้า', company: 'บริษัท ลูกค้า จำกัด', tax_id: '0105555000000' }, installment: { no: 1, of: 3, label: 'งวดที่ 1', net: 300000, vat: 21000, total: 321000 } };
  const r = q.run(
    "INSERT INTO documents (deal_id, type, number, issued_at, amount, status, data) VALUES (?, 'invoice', ?, '2026-11-01', 321000, 'issued', ?)",
    Number(deal.lastInsertRowid), `INV-T-${Math.random()}`, JSON.stringify(data),
  );
  return q.get('SELECT * FROM documents WHERE id = ?', Number(r.lastInsertRowid));
}
const linesOf = (id) => q.all('SELECT account, debit, credit FROM journal_lines WHERE entry_id = ? ORDER BY id', id)
  .map((l) => [l.account, l.debit || -l.credit]);
const assertBalanced = (id) => {
  const ls = q.all('SELECT debit, credit FROM journal_lines WHERE entry_id = ?', id);
  assert.equal(Math.round(ls.reduce((s, l) => s + l.debit - l.credit, 0) * 100), 0, 'Dr ต้องเท่ากับ Cr');
};

test('1. วางบิล: Dr 11300 321,000 / Cr 41100 300,000 / Cr 21310 21,000', () => {
  const inv = invoice();
  const e = L.billInvoice(inv, { date: '2026-11-01' });
  assertBalanced(e.id);
  assert.deepEqual(linesOf(e.id), [['11300', 321000], ['41100', -300000], ['21310', -21000]]);
  assert.throws(() => L.billInvoice(inv), L.LedgerError, 'วางบิลซ้ำไม่ได้');
});

test('2. รับชำระ หัก WHT 3%: เงินเข้า 312,000 + 11500 9,000 และย้าย VAT 21310 -> 21300', () => {
  const inv = invoice();
  L.billInvoice(inv, { date: '2026-11-01' });
  const e = L.receivePayment(inv, { date: '2026-11-20', wht_percent: 3 });
  assertBalanced(e.id);
  assert.deepEqual(linesOf(e.id), [['11200', 312000], ['11500', 9000], ['11300', -321000], ['21310', 21000], ['21300', -21000]]);
  assert.throws(() => L.receivePayment(inv), L.LedgerError, 'รับชำระซ้ำไม่ได้');
});

test('รับชำระโดยยังไม่วางบิล: ระบบบันทึกวางบิลให้ก่อน และ 21310 ของใบนั้นเป็นศูนย์', () => {
  const inv = invoice();
  L.receivePayment(inv, { date: '2026-11-21', method: 'เงินสด' });
  const bill = L.billingEntry(inv.id);
  const pay = L.paymentEntry(inv.id);
  assert.ok(bill && pay);
  assert.deepEqual(linesOf(pay.id)[0], ['11100', 321000], 'เงินสดเข้าบัญชี 11100');
  const net21310 = q.get('SELECT SUM(credit - debit) AS s FROM journal_lines WHERE account = ? AND entry_id IN (?, ?)', '21310', bill.id, pay.id).s;
  assert.equal(net21310, 0);
});

test('3. ค่าแนะนำ 5% (15,000) หัก WHT 3%: Cr 21400 450 / Cr 11200 14,550', () => {
  const e = L.recordExpense({ date: '2026-11-21', account: '61300', amount: 15000, wht_percent: 3, payee: 'ผู้แนะนำ' });
  assertBalanced(e.id);
  assert.deepEqual(linesOf(e.id), [['61300', 15000], ['11200', -14550], ['21400', -450]]);
});

test('4. ฟรีแลนซ์ 60,000 หัก WHT 3%: Cr 21400 1,800 / Cr 11200 58,200', () => {
  const e = L.recordExpense({ date: '2026-11-22', account: '51200', amount: 60000, wht_percent: 3 });
  assertBalanced(e.id);
  assert.deepEqual(linesOf(e.id), [['51200', 60000], ['11200', -58200], ['21400', -1800]]);
});

test('5. AWS/GitHub ต่างประเทศ 10,000 (ภ.พ.36): Dr 11410 700 / Cr 21300 700 / ธนาคาร 10,000', () => {
  const e = L.recordExpense({ date: '2026-11-23', account: '62300', amount: 10000, vat_mode: 'pp36' });
  assertBalanced(e.id);
  assert.deepEqual(linesOf(e.id), [['62300', 10000], ['11410', 700], ['11200', -10000], ['21300', -700]]);
});

test('ค่าใช้จ่ายมีภาษีซื้อ 7%: Dr 11400 และจ่ายรวม VAT', () => {
  const e = L.recordExpense({ date: '2026-11-24', account: '62200', amount: 1000, vat_mode: 'input' });
  assertBalanced(e.id);
  assert.deepEqual(linesOf(e.id), [['62200', 1000], ['11400', 70], ['11200', -1070]]);
});

test('รายการไม่สมดุล / บัญชีไม่มีจริง / บรรทัดเดียว ถูกปฏิเสธ', () => {
  const base = { date: '2026-11-25', memo: 'ทดสอบ', source: 'manual' };
  assert.throws(() => L.postEntry({ ...base, lines: [{ account: '11200', debit: 100 }, { account: '31100', credit: 90 }] }), L.LedgerError);
  assert.throws(() => L.postEntry({ ...base, lines: [{ account: '11200', debit: 100 }, { account: '99999', credit: 100 }] }), L.LedgerError);
  assert.throws(() => L.postEntry({ ...base, lines: [{ account: '11200', debit: 100 }] }), L.LedgerError);
  const ok = L.postEntry({ ...base, lines: [{ account: '11200', debit: 100000 }, { account: '31100', credit: 100000 }] });
  assertBalanced(ok.id);
});

test('ledger เป็น append-only: แก้/ลบไม่ได้ ต้องกลับรายการ', () => {
  const e = L.recordExpense({ date: '2026-11-25', account: '63100', amount: 500 });
  assert.throws(() => db.prepare('UPDATE journal_lines SET debit = 1 WHERE entry_id = ?').run(e.id));
  assert.throws(() => db.prepare('DELETE FROM journal_entries WHERE id = ?').run(e.id));
  const r = L.reverseEntry(e.id, { date: '2026-11-26', reason: 'บันทึกผิด' });
  assertBalanced(r.id);
  assert.equal(q.get('SELECT COUNT(*) AS n FROM transactions WHERE journal_id = ?', e.id).n, 0, 'รายการในหน้ารายรับรายจ่ายถูกลบตาม');
  assert.throws(() => L.reverseEntry(e.id), L.LedgerError, 'กลับรายการซ้ำไม่ได้');
});

test('รายการรับชำระกลับรายการไม่ได้ (ออกใบกำกับภาษีแล้ว)', () => {
  const inv = invoice();
  const p = L.receivePayment(inv, { date: '2026-11-27' });
  assert.throws(() => L.reverseEntry(p.id), L.LedgerError);
  assert.throws(() => L.reverseEntry(L.billingEntry(inv.id).id), L.LedgerError);
});

test('ทั้งเล่มสมดุล และงบทดลอง เดบิตรวม = เครดิตรวม', () => {
  assert.deepEqual(L.checkLedger(), []);
  const rows = L.balances();
  const dr = rows.reduce((s, r) => s + r.debit, 0);
  const cr = rows.reduce((s, r) => s + r.credit, 0);
  assert.equal(Math.round(dr * 100), Math.round(cr * 100));
});

test('รายงาน VAT เดือน: ภาษีขายนับเมื่อรับเงิน ไม่ใช่ตอนวางบิล', () => {
  const v = L.vatReport('2026-11');
  assert.equal(v.output_vat, 21000 * 3, 'รับชำระ 3 ใบในเดือนนี้');
  assert.equal(v.pp36_vat, 700);
  assert.equal(v.input_vat, 70);
  assert.equal(v.sales.length, 3);
  assert.equal(v.pending_21310, 21000, 'ใบที่วางบิลแต่ยังไม่รับเงิน VAT ยังพักอยู่ที่ 21310');
});

test('กลับรายการ ภ.พ.36 หักจาก ภ.พ.36 ไม่กระทบภาษีขาย', () => {
  const before = L.vatReport('2026-12');
  const e = L.recordExpense({ date: '2026-12-02', account: '62300', amount: 2000, vat_mode: 'pp36' });
  assert.equal(L.vatReport('2026-12').pp36_vat, before.pp36_vat + 140);
  L.reverseEntry(e.id, { date: '2026-12-03' });
  const after = L.vatReport('2026-12');
  assert.equal(after.pp36_vat, before.pp36_vat);
  assert.equal(after.output_vat, before.output_vat);
});
