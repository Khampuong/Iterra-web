import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, date, money, money2, todayStr } from '../lib.js';
import { Badge, Field, Icon, Modal, Stat, Tabs, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

const SOURCE = { manual: 'บันทึกทั่วไป', bill: 'วางบิล', payment: 'รับชำระ', expense: 'ค่าใช้จ่าย', reversal: 'กลับรายการ' };
const WHT_RATES = [0, 1, 2, 3, 5];
const thisMonth = () => todayStr().slice(0, 7);

// แม่แบบรายการจ่ายที่พบบ่อย (ตามเอกสารผังบัญชี)
const EXPENSE_PRESETS = [
  { label: 'ค่าแนะนำลูกค้า', account: '61300', wht_percent: 3, vat_mode: 'none', hint: 'ผู้แนะนำเป็นนิติบุคคลหัก 3% (ภ.ง.ด.53) · บุคคลธรรมดาให้นักบัญชียืนยันอัตรา (ภ.ง.ด.3)' },
  { label: 'ฟรีแลนซ์ / ผู้รับเหมาช่วง', account: '51200', wht_percent: 3, vat_mode: 'none', hint: 'หัก 3% ยื่น ภ.ง.ด.3 ภายในวันที่ 7 · ต้องมีสัญญาจ้าง + ใบสำคัญรับเงิน + สำเนาบัตร' },
  { label: 'ซอฟต์แวร์ต่างประเทศ (AWS, GitHub)', account: '62300', wht_percent: 0, vat_mode: 'pp36', hint: 'ยื่น ภ.พ.36 นำส่ง VAT 7% ภายในวันที่ 7 แล้วใช้เป็นภาษีซื้อเดือนถัดไป · ใช้กับงานลูกค้าโดยตรงให้เลือก 51300' },
  { label: 'ค่าทำบัญชี / สอบบัญชี', account: '62400', wht_percent: 3, vat_mode: 'input', hint: 'หัก 3% (สำนักงานบัญชีนิติบุคคล ภ.ง.ด.53)' },
  { label: 'ค่าเช่าสำนักงาน', account: '62100', wht_percent: 5, vat_mode: 'none', hint: 'เช่าจากกรรมการหรือบุคคลธรรมดา หัก 5% ยื่น ภ.ง.ด.3 · ต้องมีสัญญาเช่า' },
  { label: 'ค่าน้ำ ไฟ อินเทอร์เน็ต', account: '62200', wht_percent: 0, vat_mode: 'input', hint: '' },
];

const r2 = (n) => Math.round(Number(n) * 100) / 100;

// คำนวณบรรทัดบัญชีของค่าใช้จ่ายแบบเดียวกับเซิร์ฟเวอร์ เพื่อแสดงตัวอย่างก่อนบันทึก
function expenseLines(f) {
  const amount = r2(f.amount || 0);
  const vat = f.vat_mode === 'none' ? 0 : r2(amount * 0.07);
  const wht = r2((amount * (Number(f.wht_percent) || 0)) / 100);
  const paid = r2(amount + (f.vat_mode === 'input' ? vat : 0) - wht);
  return [
    [f.account, amount, 0],
    f.vat_mode === 'input' && ['11400', vat, 0],
    f.vat_mode === 'pp36' && ['11410', vat, 0],
    [f.pay_account, 0, paid],
    wht > 0 && ['21400', 0, wht],
    f.vat_mode === 'pp36' && ['21300', 0, vat],
  ].filter(Boolean);
}

export default function Accounting() {
  const { user } = useApp();
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState('overview');
  const [chart, reloadChart] = useData('/accounting/accounts');
  const [ledger, setLedger] = useState(null); // รหัสบัญชีที่เปิดดูบัญชีแยกประเภท
  if (!chart) return null;
  const name = (code) => chart.accounts.find((a) => a.code === code)?.name ?? code;

  const tabs = [['overview', 'ภาพรวม'], ['invoices', 'วางบิล / รับชำระ'], ['expense', 'บันทึกค่าใช้จ่าย'], ['journal', 'สมุดรายวัน'], ['trial', 'งบทดลอง'], ['tax', 'รายงานภาษี'], ['chart', 'ผังบัญชี']];
  if (!isAdmin) tabs.splice(2, 1);
  const common = { chart, name, isAdmin, openLedger: setLedger, reloadChart };

  return (
    <>
      <PageHead eyebrow="บัญชี" title="การเงิน" sub="บันทึกบัญชีคู่ (Dr = Cr) ตามผังบัญชีของบริษัท · ภาษีขายพักที่ 21310 จนกว่าจะได้รับเงิน" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview {...common} />}
      {tab === 'invoices' && <Invoices {...common} />}
      {tab === 'expense' && <ExpenseForm {...common} onDone={() => setTab('journal')} />}
      {tab === 'journal' && <Journal {...common} />}
      {tab === 'trial' && <TrialBalance {...common} />}
      {tab === 'tax' && <TaxReports {...common} />}
      {tab === 'chart' && <ChartOfAccounts {...common} />}
      {ledger && <LedgerModal code={ledger} onClose={() => setLedger(null)} />}
    </>
  );
}

function Overview({ openLedger }) {
  const [s] = useData('/accounting/summary');
  if (!s) return null;
  return (
    <div className="stack">
      {s.unbalanced.length > 0 && <div className="notice">พบรายการที่เดบิตไม่เท่ากับเครดิต: {s.unbalanced.map((u) => u.number).join(', ')}</div>}
      <div className="grid g4">
        <Stat hero label="เงินสดและเงินฝาก" value={money(s.cash)} hint={`฿${money2(s.cash)} · 11100 + 11200 + 11210`} />
        <Stat label="ลูกหนี้การค้า (11300)" value={money(s.receivable)} hint={`วางบิลแล้วรอรับเงิน ${s.invoices.billed} ใบ · ยังไม่วางบิล ${s.invoices.unbilled} ใบ`} />
        <Stat label="รายได้ปีนี้" value={money(s.ytd.revenue)} hint={`กำไรขั้นต้น ฿${money2(s.ytd.gross)}`} />
        <Stat label="กำไร (ก่อนภาษีเงินได้) ปีนี้" value={money(s.ytd.profit)} hint={`ต้นทุน ฿${money2(s.ytd.cost)} · ค่าใช้จ่าย ฿${money2(s.ytd.expense)}`} />
      </div>
      <div className="card">
        <div className="card-head"><h2>ภาษีที่ต้องติดตาม</h2><Badge tone={s.unbalanced.length ? 'danger' : 'ok'}>{s.unbalanced.length ? 'สมุดบัญชีไม่สมดุล' : `สมุดบัญชีสมดุล · ${s.entries} รายการ`}</Badge></div>
        <dl className="kv">
          {[
            ['21300', 'ภาษีขาย รอนำส่ง ภ.พ.30', s.vat_payable],
            ['21310', 'ภาษีขายรอเรียกเก็บ (วางบิลแล้วยังไม่ได้เงิน)', s.vat_pending],
            ['21400', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง (ภ.ง.ด.3/53)', s.wht_payable],
            ['11500', 'ภาษีที่ลูกค้าหัก ณ ที่จ่าย (ใช้หักภาษีปลายปี)', s.wht_credit],
          ].map(([code, label, v]) => (
            <div key={code} style={{ display: 'contents' }}>
              <dt><button type="button" className="linkish" onClick={() => openLedger(code)}>{code}</button> {label}</dt><dd>{money2(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="small muted">ผังบัญชีนี้เป็นแบบร่างเพื่อใช้ออกแบบระบบ ต้องให้ผู้ทำบัญชี (CPD) และผู้สอบบัญชี (CPA) ตรวจสอบยืนยันก่อนใช้จริง · เก็บเอกสารบัญชีอย่างน้อย 5 ปีตาม พ.ร.บ.การบัญชี 2543</p>
    </div>
  );
}

function RevenueSelect({ chart, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {chart.accounts.filter((a) => a.type === 'revenue' && a.active).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
    </select>
  );
}

function Invoices({ chart, isAdmin }) {
  const { run } = useApp();
  const [rows, reload] = useData('/accounting/invoices');
  const [bill, setBill] = useState(null); // { inv, date, revenue_account }
  const [pay, setPay] = useState(null); // { inv, date, method, wht_percent, revenue_account }
  if (!rows) return null;
  const doBill = async () => {
    if (await run(() => api.post(`/accounting/invoices/${bill.inv.id}/bill`, bill), `บันทึกวางบิล ${bill.inv.number} แล้ว`)) { setBill(null); reload(); }
  };
  const doPay = async () => {
    if (await run(() => api.post(`/documents/${pay.inv.id}/pay`, pay), 'รับชำระแล้ว — ออกใบเสร็จรับเงิน/ใบกำกับภาษีและบันทึกบัญชีเรียบร้อย')) { setPay(null); reload(); }
  };
  const wht = pay ? r2((pay.inv.installment.net * pay.wht_percent) / 100) : 0;
  return (
    <div className="card flush">
      <div className="card-head"><div><h2>ใบแจ้งหนี้</h2><p className="small muted">วางบิล = ตั้งลูกหนี้ (ยังไม่ใช่ใบกำกับภาษี) · รับชำระ = tax point ของงานบริการ ออกใบเสร็จรับเงิน/ใบกำกับภาษี และย้าย VAT ไป 21300</p></div></div>
      {rows.length === 0 ? <div className="empty">ยังไม่มีใบแจ้งหนี้ — ใบแจ้งหนี้เกิดเมื่อปิดการขายได้งาน</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ใบแจ้งหนี้</th><th>ลูกค้า / งาน</th><th className="right">ก่อน VAT</th><th className="right">VAT</th><th className="right">รวม</th><th>ครบกำหนด</th><th>สถานะบัญชี</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="nowrap"><a href={`/print/${i.id}`} target="_blank" rel="noreferrer">{i.number}</a><div className="small muted">{i.installment.label}</div></td>
                  <td>{i.customer}<div className="small muted"><Link to={`/deals/${i.deal_id}`}>{i.deal_code}</Link> {i.deal_title}</div></td>
                  <td className="right num">{money2(i.installment.net)}</td>
                  <td className="right num">{money2(i.installment.vat)}</td>
                  <td className="right num">{money2(i.installment.total)}</td>
                  <td className="nowrap">{date(i.due_at)}</td>
                  <td className="small">
                    {i.paid ? <Badge tone="ok">รับชำระแล้ว {date(i.paid.date)}</Badge> : i.billed ? <Badge tone="warn">วางบิลแล้ว {date(i.billed.date)}</Badge> : <Badge>ยังไม่วางบิล</Badge>}
                    {i.paid?.wht > 0 && <div className="muted">ลูกค้าหัก {i.paid.wht_percent}% = {money2(i.paid.wht)}</div>}
                    {i.receipt && <div><a href={`/print/${i.receipt.id}`} target="_blank" rel="noreferrer">{i.receipt.number}</a></div>}
                  </td>
                  <td className="right nowrap">
                    {isAdmin && !i.paid && !i.billed && <button className="btn sm" onClick={() => setBill({ inv: i, date: todayStr(), revenue_account: '41100' })}>วางบิล</button>}{' '}
                    {isAdmin && !i.paid && <button className="btn sm primary" onClick={() => setPay({ inv: i, date: todayStr(), method: 'โอนเงิน', wht_percent: 3, revenue_account: i.billed?.revenue_account ?? '41100' })}>รับชำระ</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bill && (
        <Modal title={`วางบิล ${bill.inv.number}`} onClose={() => setBill(null)} footer={<><button className="btn" onClick={() => setBill(null)}>ยกเลิก</button><button className="btn primary" onClick={doBill}>บันทึกวางบิล</button></>}>
          <div className="stack">
            <div className="grid g2">
              <Field label="วันที่วางบิล"><input type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} /></Field>
              <Field label="บัญชีรายได้"><RevenueSelect chart={chart} value={bill.revenue_account} onChange={(v) => setBill({ ...bill, revenue_account: v })} /></Field>
            </div>
            <Lines name={(c) => chart.accounts.find((a) => a.code === c)?.name} lines={[['11300', bill.inv.installment.total, 0], [bill.revenue_account, 0, bill.inv.installment.net], ['21310', 0, bill.inv.installment.vat]]} />
          </div>
        </Modal>
      )}
      {pay && (
        <Modal title={`รับชำระ ${pay.inv.number}`} onClose={() => setPay(null)} footer={<><button className="btn" onClick={() => setPay(null)}>ยกเลิก</button><button className="btn primary" onClick={doPay}>ยืนยันรับชำระ</button></>}>
          <div className="stack">
            <div className="grid g2">
              <Field label="วันที่รับเงิน (tax point)"><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
              <Field label="ช่องทาง"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option>โอนเงิน</option><option>เช็ค</option><option>เงินสด</option><option>บัตรเครดิต</option></select></Field>
              <Field label="ลูกค้าหักภาษี ณ ที่จ่าย"><select value={pay.wht_percent} onChange={(e) => setPay({ ...pay, wht_percent: Number(e.target.value) })}>{WHT_RATES.map((r) => <option key={r} value={r}>{r ? `${r}%` : 'ไม่หัก'}</option>)}</select></Field>
              {!pay.inv.billed && <Field label="บัญชีรายได้"><RevenueSelect chart={chart} value={pay.revenue_account} onChange={(v) => setPay({ ...pay, revenue_account: v })} /></Field>}
            </div>
            <p className="small">เงินเข้าบัญชีจริง <b className="num">฿{money2(pay.inv.installment.total - wht)}</b>{wht > 0 && <> · ภาษีถูกหัก ณ ที่จ่าย ฿{money2(wht)} — ต้องได้หนังสือรับรอง 50 ทวิ จากลูกค้า</>}</p>
            {!pay.inv.billed && <p className="small muted">ยังไม่ได้บันทึกวางบิล — ระบบจะบันทึกวางบิลวันเดียวกันให้ก่อน</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ตารางบรรทัดบัญชี [รหัส, เดบิต, เครดิต]
function Lines({ lines, name }) {
  const dr = lines.reduce((s, l) => s + l[1], 0);
  const cr = lines.reduce((s, l) => s + l[2], 0);
  return (
    <div className="table-wrap">
      <table className="jv">
        <thead><tr><th>บัญชี</th><th className="right">เดบิต</th><th className="right">เครดิต</th></tr></thead>
        <tbody>
          {lines.map(([code, d, c], i) => (
            <tr key={i}><td className={c ? 'cr' : ''}>{code} {name(code)}</td><td className="right num">{d ? money2(d) : ''}</td><td className="right num">{c ? money2(c) : ''}</td></tr>
          ))}
          <tr className="total"><td>รวม</td><td className="right num">{money2(dr)}</td><td className="right num">{money2(cr)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ExpenseForm({ chart, name, onDone }) {
  const { run } = useApp();
  const [projects] = useData('/projects');
  const blank = { date: todayStr(), account: '63100', amount: '', vat_mode: 'none', wht_percent: 0, pay_account: '11200', payee: '', memo: '', project_id: '' };
  const [f, setF] = useState(blank);
  const [hint, setHint] = useState('');
  const accounts = chart.accounts.filter((a) => ['cost', 'expense'].includes(a.type) && a.active);
  const lines = useMemo(() => expenseLines(f), [f]);
  const save = async () => {
    if (await run(() => api.post('/accounting/expenses', f), 'บันทึกค่าใช้จ่ายแล้ว')) { setF(blank); onDone(); }
  };
  return (
    <div className="grid g-main" style={{ alignItems: 'start' }}>
      <div className="card stack">
        <div><h2>บันทึกค่าใช้จ่าย / ต้นทุน</h2><p className="small muted">เลือกแม่แบบเพื่อตั้งบัญชีและภาษีให้อัตโนมัติ แล้วปรับได้</p></div>
        <div className="row">
          {EXPENSE_PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn sm" onClick={() => { setF({ ...f, account: p.account, wht_percent: p.wht_percent, vat_mode: p.vat_mode }); setHint(p.hint); }}>{p.label}</button>
          ))}
        </div>
        {hint && <div className="notice info">{hint}</div>}
        <div className="grid g2">
          <Field label="วันที่จ่าย"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="บัญชีค่าใช้จ่าย / ต้นทุน">
            <select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
              {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="จำนวนเงิน (ก่อน VAT)"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="ภาษีมูลค่าเพิ่ม">
            <select value={f.vat_mode} onChange={(e) => setF({ ...f, vat_mode: e.target.value })}>
              <option value="none">ไม่มี VAT / ภาษีซื้อต้องห้าม</option>
              <option value="input">มีใบกำกับภาษี — ภาษีซื้อ 7% (11400)</option>
              <option value="pp36">ผู้ให้บริการต่างประเทศ — ภ.พ.36 (11410 / 21300)</option>
            </select>
          </Field>
          <Field label="หักภาษี ณ ที่จ่าย"><select value={f.wht_percent} onChange={(e) => setF({ ...f, wht_percent: Number(e.target.value) })}>{WHT_RATES.map((r) => <option key={r} value={r}>{r ? `${r}%` : 'ไม่หัก'}</option>)}</select></Field>
          <Field label="จ่ายจาก">
            <select value={f.pay_account} onChange={(e) => setF({ ...f, pay_account: e.target.value })}>
              <option value="11200">11200 เงินฝากธนาคาร</option><option value="11100">11100 เงินสด</option>
              <option value="21100">21100 ยังไม่จ่าย — เจ้าหนี้การค้า</option><option value="21200">21200 ยังไม่จ่าย — ค่าใช้จ่ายค้างจ่าย</option>
              <option value="22100">22100 กรรมการสำรองจ่าย</option>
            </select>
          </Field>
          <Field label="ผู้รับเงิน"><input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} placeholder="ชื่อบุคคล/บริษัท" /></Field>
          <Field label="โครงการ (ถ้าเป็นต้นทุนของงาน)">
            <select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
              <option value="">— ไม่ระบุ —</option>
              {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="คำอธิบาย"><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="ว่างไว้ได้ ระบบใช้ชื่อบัญชี + ผู้รับเงิน" /></Field>
        <div><button className="btn primary" disabled={!(Number(f.amount) > 0)} onClick={save}>บันทึกรายการ</button></div>
      </div>
      <div className="card stack">
        <h2>ตัวอย่างการบันทึกบัญชี</h2>
        <Lines lines={lines} name={name} />
        {f.wht_percent > 0 && <p className="small muted">ต้องออกหนังสือรับรอง 50 ทวิ ให้ผู้รับ และนำส่งภาษีที่หักไว้ภายในวันที่ 7 ของเดือนถัดไป</p>}
      </div>
    </div>
  );
}

function Journal({ chart, name, isAdmin }) {
  const { run } = useApp();
  const [month, setMonth] = useState(thisMonth());
  const [rows, reload] = useData(`/accounting/journal${month ? `?month=${month}` : ''}`, [month]);
  const [manual, setManual] = useState(null);
  const reverse = async (e) => {
    const reason = window.prompt(`กลับรายการ ${e.number}? ระบบจะสร้างรายการใหม่ที่สลับเดบิต/เครดิต (แก้หรือลบรายการเดิมไม่ได้)\n\nเหตุผล:`);
    if (reason === null) return;
    if (await run(() => api.post(`/accounting/journal/${e.id}/reverse`, { reason }), `กลับรายการ ${e.number} แล้ว`)) reload();
  };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="row" style={{ gap: 8 }}>เดือน <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} /></label>
        {isAdmin && <button className="btn" onClick={() => setManual({ date: todayStr(), memo: '', lines: [{ account: '11200', debit: '', credit: '' }, { account: '31100', debit: '', credit: '' }] })}><Icon name="plus" />บันทึกรายการทั่วไป</button>}
      </div>
      {rows && rows.length === 0 && <div className="card empty">ไม่มีรายการบัญชีในเดือนนี้</div>}
      {(rows ?? []).map((e) => (
        <div key={e.id} className="card">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div>
              <b>{e.number}</b> <span className="muted">· {date(e.date)}</span> <Badge tone={e.source === 'reversal' ? 'danger' : 'blue'}>{SOURCE[e.source] ?? e.source}</Badge>
              <div>{e.memo}</div>
              <div className="small muted">
                {e.document_number && <>อ้างอิง {e.document_number} · </>}{e.project_code && <>โครงการ {e.project_code} · </>}บันทึกโดย {e.created_by_name ?? 'ระบบ'}
                {e.reversed_by && <> · <b>ถูกกลับรายการโดย {e.reversed_by}</b></>}
              </div>
            </div>
            {isAdmin && !e.reversed_by && !['reversal', 'payment'].includes(e.source) && <button className="btn sm ghost" onClick={() => reverse(e)}>กลับรายการ</button>}
          </div>
          <Lines lines={e.lines.map((l) => [l.account, l.debit, l.credit])} name={name} />
        </div>
      ))}
      {manual && <ManualEntry chart={chart} value={manual} setValue={setManual} onSaved={() => { setManual(null); reload(); }} />}
    </div>
  );
}

function ManualEntry({ chart, value: v, setValue, onSaved }) {
  const { run } = useApp();
  const dr = r2(v.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const cr = r2(v.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const setLine = (i, patch) => setValue({ ...v, lines: v.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const save = async () => {
    if (await run(() => api.post('/accounting/journal', v), 'บันทึกรายการบัญชีแล้ว')) onSaved();
  };
  return (
    <Modal wide title="บันทึกรายการบัญชีทั่วไป" onClose={() => setValue(null)}
      footer={<><button className="btn" onClick={() => setValue(null)}>ยกเลิก</button><button className="btn primary" disabled={dr !== cr || dr === 0} onClick={save}>บันทึก</button></>}>
      <div className="stack">
        <div className="grid g2">
          <Field label="วันที่"><input type="date" value={v.date} onChange={(e) => setValue({ ...v, date: e.target.value })} /></Field>
          <Field label="คำอธิบาย"><input value={v.memo} onChange={(e) => setValue({ ...v, memo: e.target.value })} placeholder="เช่น นำเงินทุนเข้าบริษัท / โอนเงินกันภาษี" /></Field>
        </div>
        {v.lines.map((l, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} style={{ flex: 2 }} aria-label="บัญชี">
              {chart.accounts.filter((a) => a.active).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
            <input type="number" min="0" step="0.01" placeholder="เดบิต" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} style={{ flex: 1 }} aria-label="เดบิต" />
            <input type="number" min="0" step="0.01" placeholder="เครดิต" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} style={{ flex: 1 }} aria-label="เครดิต" />
            <button className="btn ghost danger sm" disabled={v.lines.length <= 2} onClick={() => setValue({ ...v, lines: v.lines.filter((_, n) => n !== i) })} aria-label="ลบบรรทัด"><Icon name="trash" /></button>
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn sm" onClick={() => setValue({ ...v, lines: [...v.lines, { account: '63100', debit: '', credit: '' }] })}><Icon name="plus" />เพิ่มบรรทัด</button>
          <span className={dr === cr && dr > 0 ? 'small' : 'small danger-text'}>เดบิต {money2(dr)} · เครดิต {money2(cr)}{dr !== cr && ` · ต่างกัน ${money2(Math.abs(dr - cr))}`}</span>
        </div>
      </div>
    </Modal>
  );
}

function TrialBalance({ openLedger }) {
  const [to, setTo] = useState(todayStr());
  const [tb] = useData(`/accounting/trial-balance?to=${to}`, [to]);
  if (!tb) return null;
  return (
    <div className="card flush">
      <div className="card-head">
        <div><h2>งบทดลอง</h2><p className="small muted">คลิกรหัสบัญชีเพื่อดูบัญชีแยกประเภท</p></div>
        <label className="row" style={{ gap: 8 }}>ณ วันที่ <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
      </div>
      {tb.rows.length === 0 ? <div className="empty">ยังไม่มีรายการบัญชี</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th className="right">เดบิต</th><th className="right">เครดิต</th><th className="right">ยอดคงเหลือ</th></tr></thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.code}>
                  <td><button type="button" className="linkish" onClick={() => openLedger(r.code)}>{r.code}</button></td><td>{r.name}</td>
                  <td className="right num">{money2(r.debit)}</td><td className="right num">{money2(r.credit)}</td><td className="right num">{money2(r.balance)}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={2}>รวม {tb.debit === tb.credit ? '— สมดุล' : '— ไม่สมดุล'}</td><td className="right num">{money2(tb.debit)}</td><td className="right num">{money2(tb.credit)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LedgerModal({ code, onClose }) {
  const [data] = useData(`/accounting/ledger/${code}`, [code]);
  return (
    <Modal wide title={data ? `บัญชีแยกประเภท ${data.account.code} ${data.account.name}` : 'บัญชีแยกประเภท'} onClose={onClose}>
      {data && (data.lines.length === 0 ? <div className="empty">ยังไม่มีรายการในบัญชีนี้</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>วันที่</th><th>เลขที่</th><th>คำอธิบาย</th><th className="right">เดบิต</th><th className="right">เครดิต</th><th className="right">คงเหลือ</th></tr></thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={i}>
                  <td className="nowrap">{date(l.date)}</td><td className="nowrap">{l.number}</td><td>{l.memo}{l.line_memo && <div className="small muted">{l.line_memo}</div>}</td>
                  <td className="right num">{l.debit ? money2(l.debit) : ''}</td><td className="right num">{l.credit ? money2(l.credit) : ''}</td><td className="right num">{money2(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Modal>
  );
}

function TaxReports() {
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(todayStr().slice(0, 4));
  const [vat] = useData(`/accounting/vat?month=${month}`, [month]);
  const [wht] = useData(`/accounting/wht?year=${year}`, [year]);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>ภาษีมูลค่าเพิ่ม (ประกอบ ภ.พ.30)</h2><p className="small muted">ภาษีขายนับเมื่อได้รับเงิน (tax point งานบริการ) — ยอด 21300 สิ้นเดือนต้องตรงกับ ภ.พ.30</p></div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} aria-label="เดือน" />
        </div>
        {vat && (
          <>
            <dl className="kv">
              <dt>ภาษีขายเดือนนี้ (จากการรับชำระ)</dt><dd>{money2(vat.output_vat)}</dd>
              <dt>ภาษีซื้อเดือนนี้ (11400)</dt><dd>−{money2(vat.input_vat)}</dd>
              <dt>ภาษีซื้อจาก ภ.พ.36 เดือนก่อน (เครดิตเดือนนี้)</dt><dd>−{money2(vat.pp36_credit)}</dd>
              <dt className="total">ภาษีต้องชำระ ภ.พ.30 (ติดลบ = เครดิต)</dt><dd className="total">฿{money2(vat.payable)}</dd>
              <dt>ภ.พ.36 นำส่งเดือนนี้ (ยื่นภายในวันที่ 7)</dt><dd>{money2(vat.pp36_vat)}</dd>
              <dt>ภาษีขายรอเรียกเก็บ คงค้าง ณ สิ้นเดือน (21310)</dt><dd>{money2(vat.pending_21310)}</dd>
              <dt>ยอดภาษีขาย 21300 ณ สิ้นเดือน</dt><dd>{money2(vat.balance_21300)}</dd>
            </dl>
            <h3 style={{ margin: '18px 0 8px' }}>รายงานภาษีขาย</h3>
            {vat.sales.length === 0 ? <p className="muted">ไม่มีการออกใบกำกับภาษีในเดือนนี้</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>ลำดับ</th><th>วันที่</th><th>เลขที่ใบกำกับภาษี</th><th>ชื่อผู้ซื้อ</th><th>เลขประจำตัวผู้เสียภาษี</th><th>สาขา</th><th className="right">มูลค่าสินค้า/บริการ</th><th className="right">ภาษีมูลค่าเพิ่ม</th></tr></thead>
                  <tbody>
                    {vat.sales.map((s) => (
                      <tr key={s.no}><td>{s.no}</td><td className="nowrap">{date(s.date)}</td><td>{s.tax_invoice}</td><td>{s.customer}</td><td>{s.tax_id || '—'}</td><td>{s.branch}</td><td className="right num">{money2(s.net)}</td><td className="right num">{money2(s.vat)}</td></tr>
                    ))}
                    <tr className="total"><td colSpan={6}>รวม</td><td className="right num">{money2(vat.sales.reduce((a, s) => a + s.net, 0))}</td><td className="right num">{money2(vat.sales.reduce((a, s) => a + s.vat, 0))}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <div><h2>ภาษีหัก ณ ที่จ่าย</h2><p className="small muted">11500 สะสมทั้งปีต้องตรงกับหนังสือรับรอง 50 ทวิ ที่ได้รับจริง · 21400 ต้องนำส่ง ภ.ง.ด.3/53 ภายในวันที่ 7</p></div>
          <input type="number" min="2000" max="2600" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} aria-label="ปี (ค.ศ.)" />
        </div>
        {wht && (
          <div className="grid g2">
            <div>
              <h3>ลูกค้าหักเรา (11500) · รวม {money2(wht.total_11500)}</h3>
              {wht.withheld_by_customers.length === 0 ? <p className="small muted">ไม่มี</p> : (
                <ul className="plain">{wht.withheld_by_customers.map((r) => <li key={r.number}>{date(r.date)} · {r.memo} — <b className="num">{money2(r.debit - r.credit)}</b></li>)}</ul>
              )}
            </div>
            <div>
              <h3>เราหักผู้อื่น (21400) · ค้างนำส่ง {money2(wht.balance_21400)}</h3>
              {wht.withheld_from_others.length === 0 ? <p className="small muted">ไม่มี</p> : (
                <ul className="plain">{wht.withheld_from_others.map((r) => <li key={r.number}>{date(r.date)} · {r.memo}{r.meta?.wht_percent ? ` (${r.meta.wht_percent}%)` : ''} — <b className="num">{money2(r.credit - r.debit)}</b></li>)}</ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartOfAccounts({ chart, isAdmin, openLedger, reloadChart }) {
  const { run } = useApp();
  const [form, setForm] = useState(null);
  const save = async () => {
    if (await run(() => api.post('/accounting/accounts', form), `เพิ่มบัญชี ${form.code} แล้ว`)) { setForm(null); reloadChart(); }
  };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="small muted" style={{ margin: 0 }}>โครงสร้าง 5 หมวดตามรูปแบบงบการเงินที่ยื่น DBD — รหัสปรับได้ แต่หลักแรกต้องคงหมวดไว้</p>
        {isAdmin && <button className="btn" onClick={() => setForm({ code: '', name: '', type: 'expense', note: '' })}><Icon name="plus" />เพิ่มบัญชี</button>}
      </div>
      {Object.entries(chart.types).map(([type, label]) => (
        <div key={type} className="card flush">
          <div className="card-head"><h2>{label}</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: 90 }}>รหัส</th><th>ชื่อบัญชี</th><th>ใช้กับอะไรในระบบ</th><th className="right">ยอดคงเหลือ</th></tr></thead>
              <tbody>
                {chart.accounts.filter((a) => a.type === type).map((a) => (
                  <tr key={a.code}>
                    <td><button type="button" className="linkish" onClick={() => openLedger(a.code)}>{a.code}</button></td>
                    <td>{a.name}</td><td className="small muted">{a.note}</td>
                    <td className="right num">{a.used ? money2(a.balance) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {form && (
        <Modal title="เพิ่มบัญชี" onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn primary" onClick={save}>บันทึก</button></>}>
          <div className="stack">
            <div className="grid g2">
              <Field label="หมวด"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(chart.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="รหัส (5 หลัก)"><input inputMode="numeric" maxLength={5} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
            <Field label="ชื่อบัญชี"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="ใช้กับอะไรในระบบ"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
