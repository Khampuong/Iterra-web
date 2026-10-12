import { useState } from 'react';
import { api, date, money, money2, todayStr } from '../lib.js';
import { Badge, Field, Icon, Modal, Stat, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { MonthlyBars } from '../components/charts.jsx';

const CATEGORIES = {
  income: ['รับชำระค่างาน', 'ค่าบริการดูแลระบบ', 'ค่าอบรม', 'รายรับอื่น'],
  expense: ['เงินเดือนและค่าจ้าง', 'Freelance / Outsource', 'Server / Cloud / Domain', 'ซอฟต์แวร์และ License', 'การตลาด', 'ค่าเช่าและสำนักงาน', 'ภาษีและค่าธรรมเนียม', 'รายจ่ายอื่น'],
};

export default function Finance() {
  const { run, user } = useApp();
  const isAdmin = user.role === 'admin';
  const [month, setMonth] = useState('');
  const [summary, reloadSummary] = useData('/finance/summary');
  const [rows, reloadRows] = useData(`/transactions${month ? `?month=${month}` : ''}`);
  const [projects] = useData('/projects');
  const [form, setForm] = useState(null);
  if (!summary) return null;

  const reload = () => { reloadSummary(); reloadRows(); };
  const save = async () => {
    if (await run(() => api.post('/transactions', form), 'บันทึกรายการแล้ว')) { setForm(null); reload(); }
  };
  const remove = async (t) => {
    if (window.confirm('ลบรายการนี้?') && (await run(() => api.del(`/transactions/${t.id}`)))) reload();
  };
  const open = (type) => setForm({ type, category: CATEGORIES[type][0], amount: '', date: todayStr(), project_id: '', note: '' });

  return (
    <>
      <PageHead eyebrow="ขั้นที่ 5 · การเงิน" title="รายรับรายจ่าย" sub="รายรับจากใบเสร็จถูกบันทึกอัตโนมัติเป็นยอดก่อน VAT · รายจ่ายที่ผูกโครงการนับเป็นต้นทุนตรง">
        {isAdmin && <button className="btn" onClick={() => open('expense')}><Icon name="plus" />รายจ่าย</button>}
        {isAdmin && <button className="btn primary" onClick={() => open('income')}><Icon name="plus" />รายรับ</button>}
      </PageHead>

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <Stat hero label="กำไรสุทธิสะสม" value={money(summary.net)} hint="รายรับ − รายจ่ายทั้งหมด" />
        <Stat label="รายรับสะสม" value={money(summary.income)} />
        <Stat label="รายจ่ายสะสม" value={money(summary.expense)} />
        <Stat label="ลูกหนี้รอรับชำระ" value={money(summary.receivable)} hint="ใบแจ้งหนี้ที่ยังไม่ชำระ (ก่อน VAT)" />
      </div>

      <div className="grid g-main" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="card-head"><h2>รายรับและรายจ่าย 12 เดือนล่าสุด</h2></div>
          <MonthlyBars data={summary.monthly} />
        </div>
        <div className="card flush">
          <div className="card-head"><h2>กำไรขาดทุนรายโครงการ</h2></div>
          {summary.projects.length === 0 ? <div className="empty">ยังไม่มีโครงการ</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>โครงการ</th><th className="right">รับ</th><th className="right">จ่าย</th><th className="right">คงเหลือ</th></tr></thead>
                <tbody>
                  {summary.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}<div className="small muted">{p.code}</div></td>
                      <td className="right num">{money(p.income)}</td>
                      <td className="right num">{money(p.expense)}</td>
                      <td className="right num" style={{ color: p.net < 0 ? 'var(--danger)' : undefined }}>{money(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h2>รายการ</h2>
          <div className="row">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} aria-label="กรองเดือน" />
            {month && <button className="btn ghost sm" onClick={() => setMonth('')}>ทั้งหมด</button>}
          </div>
        </div>
        {rows && rows.length === 0 ? <div className="empty">ยังไม่มีรายการ{month && 'ในเดือนนี้'}</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>วันที่</th><th>ประเภท</th><th>หมวด</th><th>โครงการ</th><th>หมายเหตุ</th><th className="right">จำนวนเงิน</th><th /></tr></thead>
              <tbody>
                {(rows ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{date(t.date)}</td>
                    <td><Badge tone={t.type === 'income' ? 'ok' : ''}>{t.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</Badge></td>
                    <td>{t.category}</td>
                    <td className="nowrap">{t.project_code ?? <span className="muted">ส่วนกลาง</span>}</td>
                    <td className="small muted">{t.note}</td>
                    <td className="right num">{t.type === 'expense' ? '−' : ''}{money2(t.amount)}</td>
                    <td className="right">{isAdmin && !t.document_id && <button className="btn ghost danger sm" onClick={() => remove(t)} aria-label="ลบรายการ"><Icon name="trash" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal title={form.type === 'income' ? 'บันทึกรายรับ' : 'บันทึกรายจ่าย'} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn primary" onClick={save}>บันทึก</button></>}>
          <div className="stack">
            <div className="grid g2">
              <Field label="หมวด"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES[form.type].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="จำนวนเงิน (บาท)"><input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus /></Field>
              <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="โครงการ"><select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">ส่วนกลาง (ไม่ผูกโครงการ)</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
            </div>
            <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
