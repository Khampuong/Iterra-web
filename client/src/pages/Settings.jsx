import { useEffect, useState } from 'react';
import { api, ROLE_LABEL } from '../lib.js';
import { Badge, Field, Icon, Modal, Tabs, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

export default function Settings() {
  const { run } = useApp();
  const [settings, , setSettings] = useData('/settings');
  const [tab, setTab] = useState('pricing');
  if (!settings) return null;

  const save = async (key, value) => {
    const out = await run(() => api.put(`/settings/${key}`, value), 'บันทึกการตั้งค่าแล้ว');
    if (out) setSettings(out);
  };

  return (
    <>
      <PageHead eyebrow="ผู้ดูแลระบบ" title="ตั้งค่า" sub="อัตราค่าแรง ราคา งวดชำระ การแบ่งผลประโยชน์ และข้อมูลบริษัท" />
      <Tabs value={tab} onChange={setTab} tabs={[['pricing', 'ราคาและค่าแรง'], ['terms', 'งวดชำระและผลประโยชน์'], ['company', 'ข้อมูลบริษัท']]} />
      {tab === 'pricing' && <Pricing settings={settings} save={save} />}
      {tab === 'terms' && <Terms settings={settings} save={save} />}
      {tab === 'company' && <Company settings={settings} save={save} />}
    </>
  );
}

function NumberForm({ title, hint, fields, value, onSave }) {
  const [f, setF] = useState(value);
  useEffect(() => setF(value), [value]);
  return (
    <div className="card stack">
      <div><h2>{title}</h2>{hint && <p className="small muted">{hint}</p>}</div>
      <div className="grid g3">
        {fields.map(([k, label]) => (
          <Field key={k} label={label}><input type="number" min="0" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <div><button className="btn primary" onClick={() => onSave(f)}>บันทึก</button></div>
    </div>
  );
}

function Pricing({ settings, save }) {
  const { meta } = useApp();
  const [rates, setRates] = useState(settings.rates);
  useEffect(() => setRates(settings.rates), [settings.rates]);

  return (
    <div className="stack">
      <NumberForm title="การตั้งราคา" hint="ราคาเสนอ = ต้นทุนค่าแรง × (1 + กำไรขั้นต้น)" value={settings.pricing} onSave={(v) => save('pricing', v)}
        fields={[['margin_percent', 'กำไรขั้นต้นบวกเพิ่ม (%)'], ['vat_percent', 'VAT (%)'], ['quote_valid_days', 'ยืนราคาใบเสนอราคา (วัน)']]} />
      <NumberForm title="กำลังการผลิตของทีม" hint="ใช้ประเมินระยะเวลาและความเป็นไปได้ก่อนรับงาน" value={settings.capacity} onSave={(v) => save('capacity', v)}
        fields={[['max_active_projects', 'รับโครงการพร้อมกันได้สูงสุด'], ['parallel_people', 'จำนวนคนทำงานขนานกันต่อโครงการ'], ['buffer_percent', 'เผื่อเวลา (%)']]} />
      <div className="card stack">
        <div><h2>อัตราต้นทุนค่าแรงต่อ man-day (บาท)</h2><p className="small muted">ค่าเริ่มต้นเป็นตัวเลขตั้งต้น ควรปรับให้ตรงกับต้นทุนจริงของบริษัท</p></div>
        {meta.groups.map((g) => (
          <div key={g.id}>
            <h3 style={{ marginBottom: 10 }}>{g.name}</h3>
            <div className="grid g3">
              {meta.positions.filter((p) => p.group === g.id).map((p) => (
                <Field key={p.code} label={`${p.code} · ${p.name}`}><input type="number" min="0" step="100" value={rates[p.code]} onChange={(e) => setRates({ ...rates, [p.code]: e.target.value })} /></Field>
              ))}
            </div>
          </div>
        ))}
        <div><button className="btn primary" onClick={() => save('rates', rates)}>บันทึกอัตราค่าแรง</button></div>
      </div>
    </div>
  );
}

function Terms({ settings, save }) {
  const [terms, setTerms] = useState(settings.payment_terms);
  useEffect(() => setTerms(settings.payment_terms), [settings.payment_terms]);
  const total = terms.reduce((s, t) => s + (Number(t.percent) || 0), 0);
  const set = (i, patch) => setTerms(terms.map((t, n) => (n === i ? { ...t, ...patch } : t)));

  return (
    <div className="stack">
      <div className="card stack">
        <div><h2>งวดชำระเงิน</h2><p className="small muted">ใช้สร้างใบแจ้งหนี้อัตโนมัติเมื่อปิดการขาย — รวมต้องเท่ากับ 100%</p></div>
        {terms.map((t, i) => (
          <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
            <input value={t.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="ชื่องวด" />
            <input type="number" min="0" max="100" style={{ width: 100 }} value={t.percent} onChange={(e) => set(i, { percent: e.target.value })} aria-label="เปอร์เซ็นต์" />
            <span>%</span>
            <button className="btn ghost danger sm" disabled={terms.length === 1} onClick={() => setTerms(terms.filter((_, n) => n !== i))} aria-label="ลบงวด"><Icon name="trash" /></button>
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setTerms([...terms, { label: `งวดที่ ${terms.length + 1}`, percent: 0 }])}><Icon name="plus" />เพิ่มงวด</button>
          <span className="small" style={{ color: total === 100 ? 'var(--ok)' : 'var(--danger)' }}>รวม {total}%</span>
          <div style={{ flex: 1 }} />
          <button className="btn primary" disabled={total !== 100} onClick={() => save('payment_terms', terms)}>บันทึกงวดชำระ</button>
        </div>
      </div>
      <NumberForm title="การแบ่งผลประโยชน์" value={settings.sharing} onSave={(v) => save('sharing', v)}
        hint="คอมมิชชันฝ่ายขายคิดจากมูลค่างานก่อน VAT · ส่วนของบริษัทคิดจากยอดหลังหักต้นทุนตรงและคอมมิชชัน ที่เหลือเป็นของทีมแบ่งตามตำแหน่ง"
        fields={[['sales_percent', 'คอมมิชชันฝ่ายขาย (%)'], ['company_percent', 'ส่วนของบริษัท (%)']]} />
    </div>
  );
}

function Company({ settings, save }) {
  const [f, setF] = useState(settings.company);
  const input = (k, label, wide) => (
    <Field label={label} style={wide ? { gridColumn: '1 / -1' } : undefined}><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <div className="card stack">
      <div><h2>ข้อมูลบริษัท</h2><p className="small muted">แสดงบนหัวใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จรับเงิน และสัญญา</p></div>
      <div className="grid g2">
        {input('name_th', 'ชื่อบริษัท (ไทย)')}
        {input('name', 'ชื่อบริษัท (อังกฤษ)')}
        {input('address', 'ที่อยู่', true)}
        {input('tax_id', 'เลขประจำตัวผู้เสียภาษี')}
        {input('phone', 'โทรศัพท์')}
        {input('email', 'อีเมล')}
        {input('signer', 'ผู้มีอำนาจลงนาม')}
      </div>
      <div><button className="btn primary" onClick={() => save('company', f)}>บันทึก</button></div>
    </div>
  );
}

// หน้าจัดการสมาชิก (เฉพาะผู้ดูแลระบบ)
export function Members() {
  return (
    <>
      <PageHead eyebrow="ผู้ดูแลระบบ" title="สมาชิก" sub="เพิ่มสมาชิก กำหนดสิทธิ์และตำแหน่งงาน ตั้งรหัสผ่านใหม่ หรือปิดการใช้งาน" />
      <Users />
    </>
  );
}

function Users() {
  const { meta, run, loadMeta } = useApp();
  const [users, reload] = useData('/users');
  const [form, setForm] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const call = form.id ? () => api.put(`/users/${form.id}`, form) : () => api.post('/users', form);
    if (await run(call, 'บันทึกสมาชิกแล้ว')) { setForm(null); reload(); loadMeta(); }
  };
  const toggle = async (u) => {
    if (await run(() => api.put(`/users/${u.id}`, { active: !u.active }))) { reload(); loadMeta(); }
  };

  return (
    <div className="card flush">
      <div className="card-head">
        <div><h2>สมาชิกทั้งหมด</h2><p className="small muted">ตำแหน่งงานใช้มอบหมายงานอัตโนมัติเมื่อเปิดโครงการ</p></div>
        <button className="btn primary sm" onClick={() => setForm({ name: '', email: '', password: '', role: 'staff', position: '' })}><Icon name="plus" />เพิ่มสมาชิก</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>สิทธิ์</th><th>ตำแหน่งงาน</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td>{meta.positions.find((p) => p.code === u.position)?.name ?? '—'}</td>
                <td><Badge tone={u.active ? 'ok' : ''}>{u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge></td>
                <td className="right nowrap">
                  <button className="btn sm ghost" onClick={() => setForm({ ...u, position: u.position ?? '', password: '' })}>แก้ไข</button>
                  <button className="btn sm ghost" onClick={() => toggle(u)}>{u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal title={form.id ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก'} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn primary" onClick={save}>บันทึก</button></>}>
          <div className="grid g2">
            <Field label="ชื่อ"><input value={form.name} onChange={set('name')} autoFocus /></Field>
            <Field label="อีเมล"><input type="email" value={form.email} onChange={set('email')} disabled={Boolean(form.id)} /></Field>
            <Field label="สิทธิ์"><select value={form.role} onChange={set('role')}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="ตำแหน่งงาน"><select value={form.position} onChange={set('position')}><option value="">—</option>{meta.positions.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={form.id ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)'} style={{ gridColumn: '1 / -1' }}>
              <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
