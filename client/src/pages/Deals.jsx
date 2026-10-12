import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, date, DEAL_STATUS, money, phoneDigits, SELL } from '../lib.js';
import { Badge, Field, Icon, Modal, RequirementChecklist, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

const EMPTY = {
  title: '', customer_name: '', customer_company: '', customer_phone: '', customer_email: '', customer_tax_id: '', customer_address: '',
  project_type: 'Web Application', budget: '', deadline: '', requirement: '', requirement_checks: [],
};

export default function Deals() {
  const { run, user, meta, loadMeta } = useApp();
  const nav = useNavigate();
  const canSell = SELL.includes(user.role);
  const [deals] = useData('/deals');
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(null);
  const [added, setAdded] = useState(null); // ผลหลังบันทึก เมื่อมีการเพิ่มพนักงานขายใหม่หรือมอบงานให้คนอื่น
  const [filter, setFilter] = useState('all');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // พนักงานขาย: ถ้าชื่อตรงกับสมาชิกที่ขายงานได้จะใช้คนนั้น ไม่ตรงจะเพิ่มเป็นสมาชิกใหม่
  const sellers = meta.users.filter((u) => SELL.includes(u.role));
  const salesName = (form?.sales_name ?? '').trim().toLowerCase();
  const salesMatch = salesName ? meta.users.find((u) => u.name.trim().toLowerCase() === salesName) : null;

  const create = async () => {
    const { sales_name, sales_email, sales_password, ...deal } = form;
    const out = await run(() => api.post('/deals', { ...deal, salesperson: { name: sales_name, email: salesMatch ? '' : sales_email, password: salesMatch ? '' : sales_password } }), 'บันทึกงานขายแล้ว');
    if (!out) return;
    setForm(null);
    if (out.salesperson.created) loadMeta();
    if (out.salesperson.created || !out.can_view) setAdded(out);
    else nav(`/deals/${out.id}`);
  };

  const openForm = () => {
    setForm({ ...EMPTY, sales_name: user.name, sales_email: '', sales_password: '' });
    api.get('/deals/customers').then(setCustomers).catch(() => {});
  };
  // ดึงข้อมูลผู้ติดต่อของลูกค้าเดิมมาเติมในฟอร์ม
  const pickCustomer = (e) => {
    const c = customers[e.target.value];
    if (!c) return;
    setForm({ ...form, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === 'customer_phone' ? phoneDigits(v) : v ?? ''])) });
  };

  const rows = (deals ?? []).filter((d) => filter === 'all' || d.status === filter);

  return (
    <>
      <PageHead eyebrow="ขั้นที่ 1 · ขายงาน" title="งานขาย" sub="บันทึก Requirement จากลูกค้า ประเมินราคา และปิดการขาย">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="กรองสถานะ">
          <option value="all">ทุกสถานะ</option>
          {Object.entries(DEAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {canSell && <button className="btn primary" onClick={openForm}><Icon name="plus" />งานขายใหม่</button>}
      </PageHead>

      <div className="card flush">
        {deals && rows.length === 0 ? <div className="empty">ยังไม่มีงานขาย{canSell && ' — กด “งานขายใหม่” เพื่อเริ่มบันทึก Requirement'}</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>งาน</th><th>ลูกค้า</th><th>สถานะ</th><th className="right">ราคาเสนอ</th><th className="right">ความเป็นไปได้</th><th>ต้องการใช้งาน</th><th>ผู้ขาย</th></tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="link" onClick={() => nav(`/deals/${d.id}`)}>
                    <td>{d.title}<div className="small muted">{d.code} · {date(d.created_at)}</div></td>
                    <td>{d.customer_company || d.customer_name}</td>
                    <td>
                      <Badge tone={DEAL_STATUS[d.status].tone}>{DEAL_STATUS[d.status].label}</Badge>
                      {d.step && d.status !== 'won' && <div className="small muted" style={{ marginTop: 4 }}>ขั้น: {meta.sales_steps.find((s) => s.id === d.step)?.label}</div>}
                    </td>
                    <td className="right num">{d.net ? money(d.net) : '—'}</td>
                    <td className="right num">{d.feasibility == null ? '—' : `${d.feasibility}%`}</td>
                    <td className="nowrap">{date(d.deadline)}</td>
                    <td>{d.sales_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {added && (
        <Modal title={`บันทึกงานขาย ${added.code} แล้ว`} onClose={() => setAdded(null)}
          footer={added.can_view
            ? <button className="btn primary" onClick={() => nav(`/deals/${added.id}`)}>ไปที่งานขาย</button>
            : <button className="btn primary" onClick={() => setAdded(null)}>ปิด</button>}>
          <div className="stack">
            {added.salesperson.created ? (
              <>
                <p>เพิ่ม <b>{added.salesperson.name}</b> เป็นสมาชิกใหม่ในสิทธิ์พนักงานขาย และมอบงานนี้ให้แล้ว</p>
                <dl className="kv">
                  <dt>อีเมลเข้าระบบ</dt><dd>{added.salesperson.email}</dd>
                  <dt>ตำแหน่ง</dt><dd>Sale</dd>
                  <dt>รหัสผ่าน</dt><dd>{added.salesperson.temp_password ? <b>{added.salesperson.temp_password}</b> : 'ตามที่กำหนดไว้'}</dd>
                </dl>
                {added.salesperson.temp_password && <div className="notice">รหัสผ่านชั่วคราวนี้แสดงครั้งเดียว กรุณาจดและส่งให้พนักงานขาย แล้วให้เปลี่ยนรหัสผ่านหลังเข้าระบบ</div>}
              </>
            ) : <p>มอบงานนี้ให้ <b>{added.salesperson.name}</b> แล้ว</p>}
            {!added.can_view && <p className="small muted">งานนี้เป็นของพนักงานขายคนดังกล่าว คุณจะไม่เห็นงานนี้ในรายการของตัวเอง</p>}
          </div>
        </Modal>
      )}

      {form && (
        <Modal
          title="งานขายใหม่"
          wide
          onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn primary" onClick={create}>บันทึกและไปต่อ</button></>}
        >
          <div className="stack">
            <Field label="ชื่องาน / ระบบที่ลูกค้าต้องการ *"><input value={form.title} onChange={set('title')} autoFocus /></Field>
            <div className="grid g2">
              <Field label="พนักงานขาย">
                <input list="sellers" value={form.sales_name} onChange={set('sales_name')} placeholder="พิมพ์ชื่อ หรือเลือกจากสมาชิก" />
                <datalist id="sellers">{sellers.map((u) => <option key={u.id} value={u.name} />)}</datalist>
              </Field>
              {salesName && !salesMatch && (
                <>
                  <Field label="อีเมลพนักงานขายใหม่ *"><input type="email" value={form.sales_email} onChange={set('sales_email')} placeholder="ใช้เป็นชื่อเข้าระบบ" /></Field>
                  <Field label="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"><input type="password" autoComplete="new-password" value={form.sales_password} onChange={set('sales_password')} placeholder="เว้นว่างเพื่อให้ระบบสุ่มให้" /></Field>
                  <Field label="ตำแหน่ง"><input value="Sale · พนักงานขาย" disabled /></Field>
                </>
              )}
            </div>
            {salesName && (
              <div className={`notice${salesMatch ? ' info' : ''}`}>
                {salesMatch
                  ? `พบ “${salesMatch.name}” ในสมาชิก — งานนี้จะเป็นของสมาชิกคนนี้`
                  : 'ไม่พบชื่อนี้ในสมาชิก — ระบบจะเพิ่มเป็นสมาชิกใหม่ในสิทธิ์พนักงานขาย'}
              </div>
            )}
            {customers.length > 0 && (
              <Field label="ดึงข้อมูลลูกค้าเดิมจากระบบ">
                <select defaultValue="" onChange={pickCustomer}>
                  <option value="">— ลูกค้าใหม่ / กรอกเอง —</option>
                  {customers.map((c, i) => (
                    <option key={i} value={i}>{[c.customer_company, c.customer_name, c.customer_phone].filter(Boolean).join(' · ')}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid g2">
              <Field label="ชื่อผู้ติดต่อ *"><input value={form.customer_name} onChange={set('customer_name')} /></Field>
              <Field label="บริษัท / หน่วยงาน"><input value={form.customer_company} onChange={set('customer_company')} /></Field>
              <Field label="โทรศัพท์ (ตัวเลขไม่เกิน 10 หลัก)"><input type="tel" inputMode="numeric" maxLength={10} value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: phoneDigits(e.target.value) })} /></Field>
              <Field label="อีเมล"><input type="email" value={form.customer_email} onChange={set('customer_email')} /></Field>
              <Field label="งบประมาณลูกค้า (บาท)"><input type="number" min="0" value={form.budget} onChange={set('budget')} /></Field>
              <Field label="วันที่ต้องการใช้งาน"><input type="date" value={form.deadline} onChange={set('deadline')} /></Field>
            </div>
            <div className="field">
              <span>Requirement — ติ๊กสิ่งที่ลูกค้าต้องการ</span>
              <RequirementChecklist value={form.requirement_checks} onChange={(v) => setForm({ ...form, requirement_checks: v })} />
            </div>
            <Field label="ข้อมูลเพิ่มเติม">
              <textarea value={form.requirement} onChange={set('requirement')} style={{ minHeight: 110 }} placeholder="รายละเอียดนอกเหนือจากเช็คลิสต์ เช่น ผู้ใช้งาน ขั้นตอนเฉพาะของธุรกิจ ระบบที่ต้องเชื่อมต่อ" />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
