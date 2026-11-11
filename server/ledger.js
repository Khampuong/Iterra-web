// สมุดบัญชีแยกประเภท (double-entry) ตามผังบัญชีของบริษัท
// กฎ: ทุก journal entry ต้อง Dr = Cr · ledger เป็น append-only (แก้ด้วยรายการกลับ/reversing entry เท่านั้น)
// หมายเหตุ: ผังบัญชีเป็นแบบร่างเพื่อออกแบบระบบ ต้องให้ผู้ทำบัญชี (CPD) และผู้สอบบัญชี (CPA) ยืนยันก่อนใช้จริง
import { db, q, tx, nextCode, today } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,              -- asset | liability | equity | revenue | cost | expense
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,     -- JV-2026-0001
  date TEXT NOT NULL,
  memo TEXT NOT NULL,
  source TEXT NOT NULL,            -- manual | bill | payment | expense | reversal
  document_id INTEGER,             -- ใบแจ้งหนี้/ใบเสร็จที่เกี่ยวข้อง
  project_id INTEGER,
  reverses_id INTEGER REFERENCES journal_entries(id),
  meta TEXT,                       -- JSON ข้อมูลประกอบ เช่น ผู้รับเงิน อัตรา WHT
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account TEXT NOT NULL REFERENCES accounts(code),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  memo TEXT
);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(account);
CREATE INDEX IF NOT EXISTS journal_entries_document ON journal_entries(document_id);
-- append-only: ห้ามแก้หรือลบรายการบัญชีที่บันทึกแล้ว
CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_update BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
`);

// รายจ่ายที่บันทึกผ่านบัญชีจะสร้างรายการในหน้า "รายรับรายจ่าย" ด้วย (ผูกด้วย journal_id)
if (!db.prepare('PRAGMA table_info(transactions)').all().some((c) => c.name === 'journal_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN journal_id INTEGER');
}

export const ACCOUNT_TYPES = {
  asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของผู้ถือหุ้น', revenue: 'รายได้', cost: 'ต้นทุนบริการ', expense: 'ค่าใช้จ่ายขายและบริหาร',
};
// หลักแรกของรหัสต้องตรงหมวด (รหัสปรับได้ แต่หลักแรกต้องคงหมวดไว้)
export const TYPE_DIGIT = { asset: '1', liability: '2', equity: '3', revenue: '4', cost: '5', expense: '6' };
const DEBIT_NORMAL = ['asset', 'cost', 'expense'];

// ผังบัญชีตั้งต้น (จากเอกสาร "ผังบัญชีและการ mapping - อิเทอร์ร่า")
const CHART = [
  ['11100', 'เงินสด', 'asset', 'เงินสดย่อย'],
  ['11200', 'เงินฝากธนาคาร - กระแสรายวัน', 'asset', 'บัญชีหลักรับ-จ่าย'],
  ['11210', 'เงินฝากธนาคาร - บัญชีสำรองภาษี', 'asset', 'บัญชีที่กันเงินภาษีไว้ตามโครงสร้างแบ่งรายได้'],
  ['11300', 'ลูกหนี้การค้า', 'asset', 'ยอดตามใบแจ้งหนี้ที่ยังไม่ได้รับชำระ'],
  ['11310', 'รายได้ค้างรับ (งานที่ทำแล้วยังไม่วางบิล)', 'asset', 'งานระหว่างทำที่รับรู้รายได้ตามขั้นความสำเร็จ'],
  ['11400', 'ภาษีซื้อ', 'asset', 'VAT ที่จ่ายให้ผู้ขาย รอเครดิตในเดือนนั้น'],
  ['11410', 'ภาษีซื้อรอเรียกคืน (ภ.พ.36)', 'asset', 'VAT ที่นำส่งแทนผู้ให้บริการต่างประเทศ ใช้เครดิตเดือนถัดไป'],
  ['11500', 'ภาษีเงินได้นิติบุคคลถูกหัก ณ ที่จ่าย', 'asset', 'WHT ที่ลูกค้าหักไว้ — ไปหักกับ CIT ปลายปี · ต้องตรงกับหนังสือรับรอง 50 ทวิ'],
  ['11600', 'ค่าใช้จ่ายจ่ายล่วงหน้า', 'asset', 'ค่า SaaS/ประกันที่จ่ายเป็นรายปี'],
  ['12100', 'อุปกรณ์คอมพิวเตอร์', 'asset', 'เครื่อง จอ อุปกรณ์ทดสอบ IoT'],
  ['12190', 'ค่าเสื่อมราคาสะสม - อุปกรณ์', 'asset', 'บัญชีปรับมูลค่า (ยอดติดลบ)'],
  ['12300', 'สินทรัพย์ไม่มีตัวตน - ซอฟต์แวร์', 'asset', 'ไลเซนส์ที่ใช้เกิน 1 ปี'],
  ['21100', 'เจ้าหนี้การค้า', 'liability', 'ค่าจ้างฟรีแลนซ์/ซัพพลายเออร์ที่ยังไม่จ่าย'],
  ['21200', 'ค่าใช้จ่ายค้างจ่าย', 'liability', 'ค่าคอมมิชชันที่เกิดแล้วแต่ยังไม่ถึงงวดจ่าย'],
  ['21300', 'ภาษีขาย', 'liability', 'VAT ที่เกิดความรับผิดแล้ว รอนำส่ง ภ.พ.30'],
  ['21310', 'ภาษีขายรอเรียกเก็บ', 'liability', 'VAT ของใบแจ้งหนี้ที่ยังไม่ได้รับเงิน — ย้ายไป 21300 เมื่อเงินเข้า'],
  ['21400', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง', 'liability', 'WHT ที่เราหักคนอื่นไว้ รอนำส่ง ภ.ง.ด.1/3/53'],
  ['21500', 'ประกันสังคมค้างนำส่ง', 'liability', 'ส่วนลูกจ้าง + นายจ้าง รอนำส่ง สปส.1-10'],
  ['21600', 'ภาษีเงินได้นิติบุคคลค้างจ่าย', 'liability', 'ยอดตามการคำนวณจริงตอนปิดงบ'],
  ['21700', 'รายได้รับล่วงหน้า', 'liability', 'เงินมัดจำที่รับแล้วแต่ยังไม่ส่งมอบงาน'],
  ['22100', 'เงินกู้ยืมจากกรรมการ', 'liability', 'กรรมการสำรองจ่ายให้บริษัท'],
  ['31100', 'ทุนจดทะเบียนที่ชำระแล้ว', 'equity', 'ตามหนังสือรับรอง'],
  ['32100', 'สำรองตามกฎหมาย', 'equity', '5% ของกำไรทุกปีจนครบ 10% ของทุนจดทะเบียน'],
  ['33100', 'กำไรสะสม', 'equity', 'ที่มาของเงินปันผล'],
  ['41100', 'รายได้ค่าพัฒนาซอฟต์แวร์', 'revenue', 'เว็บบริษัท / Web app / โมดูลเสริม · tax point วันรับชำระเงิน'],
  ['41200', 'รายได้ค่าพัฒนาระบบ IoT', 'revenue', 'Dashboard IoT / ระบบเซนเซอร์ · tax point วันรับชำระเงิน'],
  ['41300', 'รายได้ค่าฝึกอบรม', 'revenue', 'ค่าอบรม / เวิร์กช็อป · tax point วันรับชำระเงิน'],
  ['41400', 'รายได้ค่าที่ปรึกษา', 'revenue', 'tax point วันรับชำระเงิน'],
  ['41500', 'รายได้ค่าบริการดูแลระบบ (MA)', 'revenue', 'MA + แก้บั๊ก (รายเดือน) · tax point วันรับชำระเงิน'],
  ['41600', 'รายได้ค่า Hosting', 'revenue', 'รายเดือน · tax point วันรับชำระเงิน'],
  ['41700', 'รายได้จากการขายอุปกรณ์', 'revenue', 'tax point วันส่งมอบ (ต่างจากบริการ)'],
  ['41900', 'รายได้ส่งออกบริการ (VAT 0%)', 'revenue', 'ลูกค้าต่างประเทศ · แยกบัญชีเพื่อกรอก ภ.พ.30 ช่องอัตรา 0%'],
  ['42100', 'รายได้อื่น', 'revenue', 'ดอกเบี้ยรับ กำไรอัตราแลกเปลี่ยน'],
  ['51100', 'ค่าแรงทีมพัฒนา', 'cost', 'เงินเดือนคนที่ทำงานในโปรเจกต์'],
  ['51200', 'ค่าจ้างฟรีแลนซ์/ผู้รับเหมาช่วง', 'cost', 'ต้องหัก WHT และมีสัญญา + ใบสำคัญรับเงิน'],
  ['51300', 'ค่าเซิร์ฟเวอร์/คลาวด์ที่ใช้กับงานลูกค้า', 'cost', 'แยกจากค่า SaaS ภายใน'],
  ['51400', 'ค่าไลเซนส์/ซอฟต์แวร์เฉพาะโปรเจกต์', 'cost', null],
  ['51500', 'ค่าอุปกรณ์ฮาร์ดแวร์ที่ส่งมอบลูกค้า', 'cost', 'เซนเซอร์ บอร์ด ที่ขายต่อ'],
  ['51600', 'ค่าเดินทางเพื่อปฏิบัติงาน', 'cost', 'ไปหน้างานลูกค้า'],
  ['61100', 'เงินเดือนและค่าตอบแทนกรรมการ', 'expense', 'ค่าตอบแทนส่วนที่ไม่ใช่ต้นทุนตรง'],
  ['61200', 'เงินสมทบประกันสังคม (ส่วนนายจ้าง)', 'expense', null],
  ['61300', 'ค่านายหน้า/ค่าแนะนำลูกค้า', 'expense', 'ตามโปรแกรมค่าแนะนำ 3/5/8%'],
  ['61400', 'ค่าคอมมิชชั่นพนักงานขาย', 'expense', 'แยกจาก 61300 เพราะภาษีคนละแบบ'],
  ['62100', 'ค่าเช่าสำนักงาน', 'expense', 'ถ้าเช่าจากกรรมการ ต้องหัก WHT 5%'],
  ['62200', 'ค่าสาธารณูปโภค', 'expense', 'ไฟ น้ำ อินเทอร์เน็ต'],
  ['62300', 'ค่าซอฟต์แวร์และบริการออนไลน์', 'expense', 'ผู้ให้บริการต่างประเทศ ต้องยื่น ภ.พ.36'],
  ['62400', 'ค่าทำบัญชีและสอบบัญชี', 'expense', 'หัก WHT 3%'],
  ['62500', 'ค่าธรรมเนียมราชการ', 'expense', 'DBD, กสทช., ค่าใบรับรอง CA'],
  ['62600', 'ค่าเสื่อมราคา', 'expense', 'อุปกรณ์ตามอายุการใช้งาน'],
  ['62700', 'ค่าตัดจำหน่ายสินทรัพย์ไม่มีตัวตน', 'expense', null],
  ['62800', 'ค่าใช้จ่ายการตลาดและประชาสัมพันธ์', 'expense', null],
  ['62900', 'ค่ารับรอง', 'expense', 'ภาษีซื้อต้องห้าม + หักได้ไม่เกิน 0.3% ของรายได้'],
  ['63100', 'ค่าใช้จ่ายเบ็ดเตล็ด', 'expense', null],
  ['64100', 'ภาษีเงินได้นิติบุคคล', 'expense', 'คำนวณตอนปิดงบ'],
];
{
  const ins = db.prepare('INSERT OR IGNORE INTO accounts (code, name, type, note) VALUES (?, ?, ?, ?)');
  for (const [code, name, type, note] of CHART) ins.run(code, name, type, note);
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const accountByCode = (code) => q.get('SELECT * FROM accounts WHERE code = ?', code);

export class LedgerError extends Error {}

// บันทึกรายการบัญชี: ตรวจ Dr = Cr และบัญชีมีอยู่จริงก่อนเสมอ
export function postEntry({ date = today(), memo, source, document_id = null, project_id = null, reverses_id = null, meta = null, user_id = null, lines }) {
  const clean = lines
    .map((l) => ({ account: String(l.account), debit: round2(l.debit || 0), credit: round2(l.credit || 0), memo: l.memo ?? null }))
    .filter((l) => l.debit || l.credit);
  if (clean.length < 2) throw new LedgerError('รายการบัญชีต้องมีอย่างน้อย 2 บรรทัด');
  for (const l of clean) {
    if (l.debit < 0 || l.credit < 0) throw new LedgerError('จำนวนเงินต้องไม่ติดลบ');
    if (l.debit && l.credit) throw new LedgerError('บรรทัดเดียวใส่ได้ทั้งเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง');
    if (!accountByCode(l.account)) throw new LedgerError(`ไม่พบบัญชี ${l.account} ในผังบัญชี`);
  }
  const dr = round2(clean.reduce((s, l) => s + l.debit, 0));
  const cr = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr) throw new LedgerError(`เดบิต (${dr.toLocaleString('th-TH')}) ต้องเท่ากับเครดิต (${cr.toLocaleString('th-TH')})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LedgerError('วันที่ไม่ถูกต้อง');
  if (!String(memo || '').trim()) throw new LedgerError('กรุณาใส่คำอธิบายรายการ');

  return tx(() => {
    const number = nextCode('journal_entries', 'number', 'JV');
    const r = q.run(
      'INSERT INTO journal_entries (number, date, memo, source, document_id, project_id, reverses_id, meta, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      number, date, String(memo).trim().slice(0, 300), source, document_id, project_id, reverses_id, meta ? JSON.stringify(meta) : null, user_id,
    );
    const id = Number(r.lastInsertRowid);
    for (const l of clean) q.run('INSERT INTO journal_lines (entry_id, account, debit, credit, memo) VALUES (?, ?, ?, ?, ?)', id, l.account, l.debit, l.credit, l.memo);
    return { id, number };
  });
}

// รายการที่ยังมีผล (ยังไม่ถูกกลับรายการ) ของเอกสาร
const activeEntry = (documentId, source) => q.get(
  `SELECT * FROM journal_entries e WHERE e.document_id = ? AND e.source = ?
   AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = e.id) ORDER BY e.id DESC LIMIT 1`,
  documentId, source,
);
export const billingEntry = (invoiceId) => activeEntry(invoiceId, 'bill');
export const paymentEntry = (invoiceId) => activeEntry(invoiceId, 'payment');

const projectOf = (dealId) => q.get('SELECT id FROM projects WHERE deal_id = ?', dealId)?.id ?? null;

// 1) วางบิล: Dr ลูกหนี้ / Cr รายได้ (ก่อน VAT) / Cr ภาษีขายรอเรียกเก็บ — ยังไม่ใช่ใบกำกับภาษี
export function billInvoice(inv, { date = today(), revenue_account = '41100', user_id = null } = {}) {
  if (inv.type !== 'invoice') throw new LedgerError('วางบิลได้เฉพาะใบแจ้งหนี้');
  if (inv.status === 'void') throw new LedgerError('ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว');
  if (billingEntry(inv.id)) throw new LedgerError(`ใบแจ้งหนี้ ${inv.number} บันทึกวางบิลแล้ว`);
  const acct = accountByCode(revenue_account);
  if (!acct || acct.type !== 'revenue') throw new LedgerError('กรุณาเลือกบัญชีรายได้');
  const { net, vat, total } = JSON.parse(inv.data).installment;
  return postEntry({
    date, source: 'bill', document_id: inv.id, project_id: projectOf(inv.deal_id), user_id,
    memo: `วางบิล ${inv.number}`, meta: { revenue_account },
    lines: [
      { account: '11300', debit: total },
      { account: revenue_account, credit: net },
      { account: '21310', credit: vat },
    ],
  });
}

// 2) รับชำระ (tax point ของงานบริการ): เงินเข้า + WHT ที่ลูกค้าหัก / ล้างลูกหนี้ · ย้าย VAT 21310 -> 21300
export function receivePayment(inv, { date = today(), wht_percent = 0, method = 'โอนเงิน', receipt_id = null, user_id = null, revenue_account } = {}) {
  if (paymentEntry(inv.id)) throw new LedgerError(`ใบแจ้งหนี้ ${inv.number} บันทึกรับชำระแล้ว`);
  if (!billingEntry(inv.id)) billInvoice(inv, { date, revenue_account, user_id }); // ยังไม่ได้วางบิลในบัญชี: บันทึกวางบิลวันเดียวกันก่อน
  const { net, vat, total } = JSON.parse(inv.data).installment;
  const pct = Number(wht_percent) || 0;
  if (pct < 0 || pct > 15) throw new LedgerError('อัตราหัก ณ ที่จ่ายไม่ถูกต้อง');
  const wht = round2((net * pct) / 100); // WHT คิดจากยอดก่อน VAT
  const cashAccount = method === 'เงินสด' ? '11100' : '11200';
  return postEntry({
    date, source: 'payment', document_id: inv.id, project_id: projectOf(inv.deal_id), user_id,
    memo: `รับชำระ ${inv.number}${pct ? ` (ลูกค้าหัก ณ ที่จ่าย ${pct}%)` : ''}`,
    meta: { wht_percent: pct, wht, method, receipt_id },
    lines: [
      { account: cashAccount, debit: total - wht },
      { account: '11500', debit: wht, memo: pct ? 'ต้องได้หนังสือรับรอง 50 ทวิ จากลูกค้า' : null },
      { account: '11300', credit: total },
      { account: '21310', debit: vat, memo: 'ล้างภาษีขายรอเรียกเก็บ' },
      { account: '21300', credit: vat, memo: 'เข้า ภ.พ.30 เดือนนี้' },
    ],
  });
}

// 3) ค่าใช้จ่าย/ต้นทุน: รองรับภาษีซื้อ, ภ.พ.36 (บริการต่างประเทศ) และหัก ณ ที่จ่าย
export function recordExpense(b, user_id = null) {
  const acct = accountByCode(b.account);
  if (!acct || !['cost', 'expense', 'asset'].includes(acct.type)) throw new LedgerError('กรุณาเลือกบัญชีค่าใช้จ่ายหรือต้นทุน');
  const amount = round2(b.amount);
  if (!(amount > 0)) throw new LedgerError('กรุณาใส่จำนวนเงิน (ก่อน VAT)');
  const vatMode = ['none', 'input', 'pp36'].includes(b.vat_mode) ? b.vat_mode : 'none';
  const vat = vatMode === 'none' ? 0 : round2(amount * 0.07);
  const pct = Number(b.wht_percent) || 0;
  if (pct < 0 || pct > 15) throw new LedgerError('อัตราหัก ณ ที่จ่ายไม่ถูกต้อง');
  const wht = round2((amount * pct) / 100);
  const payFrom = ['11200', '11100', '21100', '21200', '22100'].includes(b.pay_account) ? b.pay_account : '11200';
  const paid = round2(amount + (vatMode === 'input' ? vat : 0) - wht);
  const payee = String(b.payee || '').trim().slice(0, 120);
  const memo = String(b.memo || '').trim() || `${acct.name}${payee ? ` — ${payee}` : ''}`;
  const lines = [
    { account: acct.code, debit: amount },
    vatMode === 'input' && { account: '11400', debit: vat, memo: 'ภาษีซื้อ' },
    vatMode === 'pp36' && { account: '11410', debit: vat, memo: 'ภ.พ.36 — ใช้เป็นภาษีซื้อเดือนถัดไป' },
    { account: payFrom, credit: paid },
    pct && { account: '21400', credit: wht, memo: `หัก ณ ที่จ่าย ${pct}% — ออกหนังสือรับรอง 50 ทวิ ให้ผู้รับ` },
    vatMode === 'pp36' && { account: '21300', credit: vat, memo: 'นำส่ง ภ.พ.36 แทนผู้ให้บริการต่างประเทศ ภายในวันที่ 7' },
  ].filter(Boolean);
  const projectId = b.project_id ? Number(b.project_id) : null;
  return tx(() => {
    const e = postEntry({
      date: b.date || today(), source: 'expense', project_id: projectId, user_id, memo,
      meta: { payee, wht_percent: pct, wht, vat_mode: vatMode, vat },
      lines,
    });
    // แสดงในหน้า "รายรับรายจ่าย" ด้วย (ยอดก่อน VAT)
    if (acct.type !== 'asset') {
      q.run(
        "INSERT INTO transactions (project_id, type, category, amount, date, note, journal_id) VALUES (?, 'expense', ?, ?, ?, ?, ?)",
        projectId, acct.name, amount, b.date || today(), `${e.number} ${memo}`, e.id,
      );
    }
    return e;
  });
}

// กลับรายการ: สร้างรายการใหม่ที่สลับ Dr/Cr (ห้ามแก้รายการเดิม)
export function reverseEntry(id, { date = today(), reason = '', user_id = null } = {}) {
  const e = q.get('SELECT * FROM journal_entries WHERE id = ?', id);
  if (!e) throw new LedgerError('ไม่พบรายการบัญชี');
  if (e.source === 'reversal') throw new LedgerError('รายการนี้เป็นรายการกลับอยู่แล้ว');
  if (q.get('SELECT 1 FROM journal_entries WHERE reverses_id = ?', id)) throw new LedgerError('รายการนี้ถูกกลับรายการแล้ว');
  if (e.source === 'payment') throw new LedgerError('รายการรับชำระออกใบเสร็จ/ใบกำกับภาษีไปแล้ว — ปรับปรุงด้วยรายการบัญชีทั่วไปแทน');
  if (e.source === 'bill' && paymentEntry(e.document_id)) throw new LedgerError('ใบแจ้งหนี้นี้รับชำระแล้ว กลับรายการวางบิลไม่ได้');
  const lines = q.all('SELECT * FROM journal_lines WHERE entry_id = ?', id);
  return tx(() => {
    const r = postEntry({
      date, source: 'reversal', reverses_id: id, document_id: e.document_id, project_id: e.project_id, user_id,
      memo: `กลับรายการ ${e.number}${reason ? ` — ${reason}` : ''}`,
      lines: lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, memo: l.memo })),
    });
    q.run('DELETE FROM transactions WHERE journal_id = ?', id); // รายการในหน้า "รายรับรายจ่าย" ที่มาจากบัญชีนี้
    return r;
  });
}

// ---------- รายงาน ----------
export function balances({ from = null, to = null } = {}) {
  const rows = q.all(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account = a.code
       AND l.entry_id IN (SELECT id FROM journal_entries WHERE (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?))
     GROUP BY a.code ORDER BY a.code`,
    from, from, to, to,
  );
  return rows.map((r) => {
    const debit = round2(r.debit);
    const credit = round2(r.credit);
    const balance = round2(DEBIT_NORMAL.includes(r.type) ? debit - credit : credit - debit);
    return { ...r, debit, credit, balance };
  });
}

export const balanceOf = (code, opts) => balances(opts).find((b) => b.code === code)?.balance ?? 0;

export function entriesWithLines(where = '', ...params) {
  const entries = q.all(
    `SELECT e.*, u.name AS created_by_name, d.number AS document_number, p.code AS project_code,
            (SELECT r.number FROM journal_entries r WHERE r.reverses_id = e.id) AS reversed_by,
            (SELECT o.number FROM journal_entries o WHERE o.id = e.reverses_id) AS reverses_number
     FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN documents d ON d.id = e.document_id LEFT JOIN projects p ON p.id = e.project_id
     ${where} ORDER BY e.date DESC, e.id DESC LIMIT 500`,
    ...params,
  );
  const lines = q.all(
    `SELECT l.*, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.code = l.account WHERE l.entry_id IN (${entries.map(() => '?').join(',') || 'NULL'}) ORDER BY l.id`,
    ...entries.map((e) => e.id),
  );
  return entries.map((e) => ({ ...e, meta: e.meta ? JSON.parse(e.meta) : null, lines: lines.filter((l) => l.entry_id === e.id) }));
}

const monthEnd = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const prevMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
// รายการกลับนับตามประเภทของรายการต้นทาง (เช่น กลับรายการ ภ.พ.36 ต้องหักจาก ภ.พ.36 ไม่ใช่ภาษีขาย)
const sumLines = (account, side, from, to, sources = null) => round2(q.get(
  `SELECT COALESCE(SUM(l.${side}), 0) AS s FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
   LEFT JOIN journal_entries o ON o.id = e.reverses_id
   WHERE l.account = ? AND e.date >= ? AND e.date <= ?
   ${sources ? `AND COALESCE(o.source, e.source) IN (${sources.map((s) => `'${s}'`).join(', ')})` : ''}`,
  account, from, to,
).s);
const netCredit = (account, from, to, sources) => round2(sumLines(account, 'credit', from, to, sources) - sumLines(account, 'debit', from, to, sources));

// สรุปภาษีมูลค่าเพิ่มรายเดือน (ประกอบการยื่น ภ.พ.30) + รายงานภาษีขาย
export function vatReport(month) {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const pFrom = `${prevMonth(month)}-01`;
  const pTo = monthEnd(prevMonth(month));
  const output = netCredit('21300', from, to, ['payment', 'manual', 'bill']);
  const pp36 = netCredit('21300', from, to, ['expense']);
  const input = -netCredit('11400', from, to);
  const pp36Prev = -netCredit('11410', pFrom, pTo); // ภ.พ.36 เดือนก่อน ใช้เครดิตเดือนนี้
  const sales = q.all(
    `SELECT e.date, e.meta, d.number AS invoice_number, d.data FROM journal_entries e JOIN documents d ON d.id = e.document_id
     WHERE e.source = 'payment' AND e.date >= ? AND e.date <= ? AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = e.id)
     ORDER BY e.date, e.id`,
    from, to,
  ).map((r, i) => {
    const data = JSON.parse(r.data);
    const meta = JSON.parse(r.meta || '{}');
    const receipt = meta.receipt_id ? q.get('SELECT number FROM documents WHERE id = ?', meta.receipt_id)?.number : null;
    return {
      no: i + 1, date: r.date, tax_invoice: receipt ?? r.invoice_number, customer: data.customer.company || data.customer.name,
      tax_id: data.customer.tax_id || '', branch: 'สำนักงานใหญ่', net: data.installment.net, vat: data.installment.vat,
    };
  });
  return {
    month, from, to,
    output_vat: output, pp36_vat: pp36, input_vat: input, pp36_credit: pp36Prev,
    payable: round2(output - input - pp36Prev),
    balance_21300: balanceOf('21300', { to }),
    pending_21310: balanceOf('21310', { to }),
    sales,
  };
}

// ภาษีหัก ณ ที่จ่าย: ที่ลูกค้าหักเรา (11500) และที่เราหักคนอื่นรอนำส่ง (21400)
export function whtReport(year) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const list = (account) => q.all(
    `SELECT e.number, e.date, e.memo, e.meta, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account = ? AND e.date >= ? AND e.date <= ? ORDER BY e.date, e.id`,
    account, from, to,
  ).map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
  return {
    year,
    withheld_by_customers: list('11500'), total_11500: round2(sumLines('11500', 'debit', from, to) - sumLines('11500', 'credit', from, to)),
    withheld_from_others: list('21400'), balance_21400: balanceOf('21400', { to }),
  };
}

// ตรวจความถูกต้องของสมุดบัญชีทั้งเล่ม: ทุกรายการ Dr = Cr
export function checkLedger() {
  return q.all(
    `SELECT e.number, ROUND(SUM(l.debit), 2) AS dr, ROUND(SUM(l.credit), 2) AS cr FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
     GROUP BY e.id HAVING ROUND(SUM(l.debit), 2) != ROUND(SUM(l.credit), 2)`,
  );
}
