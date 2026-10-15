import { useState } from 'react';
import { api, date, money2, todayStr } from '../lib.js';
import { Badge, Field, Icon, Modal, useApp, useData } from './ui.jsx';

const TONE = { draft: '', quoted: 'warn', approved: 'ok', rejected: 'danger' };
const EMPTY_ITEM = { title: '', description: '', effort: { FE: 1, BE: 1 }, price_override: '' };

// งานเพิ่มเติมหลังปิดการขาย: เพิ่มรายการ -> ออกใบเสนอราคาเพิ่มเติม -> บันทึกผลลูกค้า
export default function DealExtras({ deal }) {
  const { user, run } = useApp();
  const [extras, reload] = useData(`/deals/${deal.id}/extras`);
  const [form, setForm] = useState(null); // { id?, title, items, discount, duration_days, note }
  const [approve, setApprove] = useState(null); // { ex, start_date }
  // ปรับราคา/ส่วนลดเพื่อต่อรองได้: admin ผู้ถือหุ้น และพนักงานขายเจ้าของงาน
  const canPrice = ['admin', 'shareholder'].includes(user.role) || deal.sales_id === user.id;
  const canEdit = canPrice;
  const canDecide = user.role === 'admin' || deal.sales_id === user.id;

  const open = (ex) => setForm(ex
    ? { id: ex.id, title: ex.title, items: ex.items.map((i) => ({ title: i.title, description: i.description, effort: { ...i.effort }, price_override: i.price_override ?? '' })), discount: ex.discount, duration_days: ex.duration_days, note: ex.note ?? '' }
    : { title: '', items: [{ ...EMPTY_ITEM }], discount: 0, duration_days: 5, note: '' });
  const save = async () => {
    const call = form.id ? () => api.put(`/deals/${deal.id}/extras/${form.id}`, form) : () => api.post(`/deals/${deal.id}/extras`, form);
    if (await run(call, 'บันทึกงานเพิ่มเติมแล้ว')) { setForm(null); reload(); }
  };
  const act = async (ex, path, ok, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    if (await run(() => (path === 'delete' ? api.del(`/deals/${deal.id}/extras/${ex.id}`) : api.post(`/deals/${deal.id}/extras/${ex.id}/${path}`)), ok)) reload();
  };
  const doApprove = async () => {
    if (await run(() => api.post(`/deals/${deal.id}/extras/${approve.ex.id}/approve`, { start_date: approve.start_date }), 'บันทึกการอนุมัติแล้ว — ออกใบแจ้งหนี้และเพิ่มงานเข้าโครงการเรียบร้อย')) {
      setApprove(null);
      reload();
    }
  };
  const setItem = (i, patch) => setForm({ ...form, items: form.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) });

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          <h2>งานเพิ่มเติมหลังปิดการขาย</h2>
          <p className="small muted">ลูกค้าขอเพิ่มงาน: ออกใบเสนอราคาเพิ่มเติมแยกจากใบหลัก เมื่อลูกค้าอนุมัติ ระบบออกใบแจ้งหนี้ เพิ่มมูลค่าและงานเข้าโครงการให้</p>
        </div>
        {canEdit && <button className="btn sm" onClick={() => open(null)}><Icon name="plus" />เพิ่มงานเพิ่มเติม</button>}
      </div>
      {extras && extras.length === 0 ? <div className="empty">ยังไม่มีงานเพิ่มเติม</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>งานเพิ่มเติม</th><th className="right">รวม VAT</th><th>ระยะเวลา</th><th>สถานะ</th><th>เอกสาร</th><th /></tr></thead>
            <tbody>
              {(extras ?? []).map((ex) => (
                <tr key={ex.id}>
                  <td>#{ex.no} {ex.title}<div className="small muted">{ex.items.length} รายการ · ก่อน VAT {money2(ex.totals.net)}</div></td>
                  <td className="right num">{money2(ex.totals.total)}</td>
                  <td className="nowrap">{ex.duration_days} วันทำการ</td>
                  <td><Badge tone={TONE[ex.status]}>{ex.status_label}</Badge></td>
                  <td className="small nowrap">
                    {ex.quote && <a href={`/print/${ex.quote.id}`} target="_blank" rel="noreferrer">{ex.quote.number}</a>}
                    {ex.invoice && <> · <a href={`/print/${ex.invoice.id}`} target="_blank" rel="noreferrer">{ex.invoice.number}</a></>}
                    {!ex.quote && '—'}
                  </td>
                  <td className="right nowrap">
                    {ex.status === 'draft' && canEdit && <button className="btn sm ghost" onClick={() => open(ex)}>แก้ไข</button>}
                    {ex.status === 'draft' && canDecide && <button className="btn sm" onClick={() => act(ex, 'quote', 'ออกใบเสนอราคาเพิ่มเติมแล้ว')}>ออกใบเสนอราคา</button>}
                    {ex.status === 'draft' && canEdit && <button className="btn sm ghost danger" onClick={() => act(ex, 'delete', 'ลบงานเพิ่มเติมแล้ว', `ลบงานเพิ่มเติม #${ex.no}?`)} aria-label="ลบ"><Icon name="trash" /></button>}
                    {ex.status === 'quoted' && canDecide && <>
                      <button className="btn sm primary" onClick={() => setApprove({ ex, start_date: todayStr() })}>ลูกค้าอนุมัติ</button>{' '}
                      <button className="btn sm ghost" onClick={() => act(ex, 'reject', 'บันทึกว่าลูกค้าไม่อนุมัติแล้ว', 'บันทึกว่าลูกค้าไม่อนุมัติงานเพิ่มเติมนี้? ใบเสนอราคาเพิ่มเติมจะถูกยกเลิก')}>ไม่อนุมัติ</button>
                    </>}
                    {ex.status === 'approved' && <span className="small muted">อนุมัติ {date(ex.approved_at)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <ExtraForm form={form} setForm={setForm} setItem={setItem} canPrice={canPrice} onSave={save} onClose={() => setForm(null)} />
      )}
      {approve && (
        <Modal title={`ลูกค้าอนุมัติงานเพิ่มเติม #${approve.ex.no}`} onClose={() => setApprove(null)}
          footer={<><button className="btn" onClick={() => setApprove(null)}>ยกเลิก</button><button className="btn primary" onClick={doApprove}>ยืนยัน</button></>}>
          <div className="stack">
            <p>ระบบจะออกใบแจ้งหนี้ <b className="num">฿{money2(approve.ex.totals.total)}</b> เพิ่มมูลค่าโครงการ {money2(approve.ex.totals.net)} บาท (ก่อน VAT) และเพิ่มงานตามตำแหน่งเข้าโครงการ ถ้าเสร็จหลังวันส่งมอบเดิม วันส่งมอบจะขยายออกไป</p>
            <Field label={`วันเริ่มงานเพิ่มเติม (ใช้เวลา ${approve.ex.duration_days} วันทำการ)`}>
              <input type="date" value={approve.start_date} onChange={(e) => setApprove({ ...approve, start_date: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ExtraForm({ form, setForm, setItem, canPrice, onSave, onClose }) {
  const { meta, user } = useApp();
  return (
    <Modal wide title={form.id ? 'แก้ไขงานเพิ่มเติม' : 'เพิ่มงานเพิ่มเติม'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ยกเลิก</button><button className="btn primary" onClick={onSave}>บันทึก</button></>}>
      <div className="stack">
        <Field label="ชื่องานเพิ่มเติม"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="เช่น เพิ่มระบบสมาชิกและคูปองส่วนลด" autoFocus /></Field>
        <div className="small muted">ราคาคำนวณจากกำลังคน (man-day) ด้วยอัตราค่าแรงในหน้าตั้งค่า{canPrice ? ' · กำหนดราคาเองหรือให้ส่วนลดเพื่อต่อรองได้' : ''}{canPrice && !['admin', 'shareholder'].includes(user.role) ? ` (พนักงานขายลดได้ไม่เกิน ${meta.max_sales_discount_percent ?? 10}% จากราคาคำนวณ)` : ''}</div>
        {form.items.map((it, i) => (
          <div key={i} className="stack" style={{ gap: 8, borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
            <div className="row m-wrap" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div className="stack m-full" style={{ flex: 1, gap: 8 }}>
                <input placeholder="ชื่อรายการ" value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} aria-label="ชื่อรายการ" />
                <input placeholder="รายละเอียด" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} aria-label="รายละเอียด" />
              </div>
              {canPrice && (
                <Field label="ราคากำหนดเอง" style={{ width: 150 }}>
                  <input type="number" min="0" placeholder="คำนวณอัตโนมัติ" value={it.price_override} onChange={(e) => setItem(i, { price_override: e.target.value })} />
                </Field>
              )}
              <button className="btn ghost danger sm" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, n) => n !== i) })} aria-label="ลบรายการ"><Icon name="trash" /></button>
            </div>
            <div className="row">
              {Object.entries(it.effort).map(([code, d]) => (
                <label key={code} className="row" style={{ gap: 4 }}>
                  <span className="small">{code}</span>
                  <input className="inline-input" type="number" min="0" step="0.5" style={{ width: 70 }} value={d} onChange={(e) => setItem(i, { effort: { ...it.effort, [code]: e.target.value } })} />
                </label>
              ))}
              <select className="inline-input" style={{ width: 'auto' }} value="" aria-label="เพิ่มตำแหน่ง" onChange={(e) => e.target.value && setItem(i, { effort: { ...it.effort, [e.target.value]: 1 } })}>
                <option value="">+ ตำแหน่ง</option>
                {meta.positions.filter((p) => !(p.code in it.effort)).map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
              </select>
            </div>
          </div>
        ))}
        <div><button className="btn sm" onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM }] })}><Icon name="plus" />เพิ่มรายการ</button></div>
        <div className="grid g2">
          {canPrice && <Field label="ส่วนลด (บาท)"><input type="number" min="0" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></Field>}
          <Field label="ระยะเวลา (วันทำการ)"><input type="number" min="1" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: e.target.value })} /></Field>
        </div>
        <Field label="หมายเหตุ / เงื่อนไขในใบเสนอราคาเพิ่มเติม"><textarea style={{ minHeight: 80 }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
