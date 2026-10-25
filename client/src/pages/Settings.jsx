import { useEffect, useState } from 'react';
import { api, money, phoneDigits, ROLE_LABEL } from '../lib.js';
import { Avatar, Badge, Field, Icon, Modal, PhotoPicker, Tabs, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

export default function Settings() {
  const { run, loadMeta } = useApp();
  const [settings, , setSettings] = useData('/settings');
  const [tab, setTab] = useState('pricing');
  if (!settings) return null;

  const save = async (key, value) => {
    const out = await run(() => api.put(`/settings/${key}`, value), 'บันทึกการตั้งค่าแล้ว');
    if (out) {
      setSettings(out);
      if (key === 'sales_steps' || key === 'requirement_items' || key === 'email') loadMeta();
    }
  };

  return (
    <>
      <PageHead eyebrow="ผู้ดูแลระบบ" title="ตั้งค่า" sub="อัตราค่าแรง ราคา งวดชำระ การแบ่งผลประโยชน์ และข้อมูลบริษัท" />
      <Tabs value={tab} onChange={setTab} tabs={[['pricing', 'ราคาและค่าแรง'], ['terms', 'งวดชำระและผลประโยชน์'], ['steps', 'ขั้นตอนงานขาย'], ['checklist', 'เช็คลิสต์ Requirement'], ['email', 'อีเมลแจ้งเตือน'], ['company', 'ข้อมูลบริษัท']]} />
      {tab === 'pricing' && <Pricing settings={settings} save={save} />}
      {tab === 'terms' && <Terms settings={settings} save={save} />}
      {tab === 'steps' && <SalesSteps settings={settings} save={save} />}
      {tab === 'checklist' && <ChecklistItems settings={settings} save={save} />}
      {tab === 'email' && <EmailSettings settings={settings} save={save} />}
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
  const hours = Number(settings.capacity.hours_per_day) > 0 ? Number(settings.capacity.hours_per_day) : 8;

  return (
    <div className="stack">
      <NumberForm title="การตั้งราคา" hint="ราคาเสนอ = ต้นทุนค่าแรง × (1 + กำไรขั้นต้น)" value={settings.pricing} onSave={(v) => save('pricing', v)}
        fields={[['margin_percent', 'กำไรขั้นต้นบวกเพิ่ม (%)'], ['vat_percent', 'VAT (%)'], ['quote_valid_days', 'ยืนราคาใบเสนอราคา (วัน)'], ['max_sales_discount_percent', 'พนักงานขายลดราคาได้ไม่เกิน (%)']]} />
      <NumberForm title="กำลังการผลิตของทีม" hint="ใช้ประเมินระยะเวลาและความเป็นไปได้ก่อนรับงาน" value={settings.capacity} onSave={(v) => save('capacity', v)}
        fields={[['max_active_projects', 'รับโครงการพร้อมกันได้สูงสุด'], ['parallel_people', 'จำนวนคนทำงานขนานกันต่อโครงการ'], ['buffer_percent', 'เผื่อเวลา (%)'], ['hours_per_day', 'ชั่วโมงทำงานต่อ man-day']]} />
      <div className="card stack">
        <div><h2>อัตราต้นทุนค่าแรงต่อชั่วโมง (บาท)</h2><p className="small muted">ต้นทุนต่อ man-day = อัตราต่อชั่วโมง × {hours} ชั่วโมง (ตั้งได้ที่ “ชั่วโมงทำงานต่อ man-day”) · ค่าเริ่มต้นเป็นตัวเลขตั้งต้น ควรปรับให้ตรงกับต้นทุนจริงของบริษัท</p></div>
        {meta.groups.map((g) => (
          <div key={g.id}>
            <h3 style={{ marginBottom: 10 }}>{g.name}</h3>
            <div className="grid g3">
              {meta.positions.filter((p) => p.group === g.id).map((p) => (
                <Field key={p.code} label={`${p.code} · ${p.name}`}>
                  <input type="number" min="0" step="10" value={rates[p.code]} onChange={(e) => setRates({ ...rates, [p.code]: e.target.value })} />
                  <span className="small muted">≈ {money(Number(rates[p.code] || 0) * hours)} / man-day</span>
                </Field>
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

// เช็คลิสต์ Requirement: รายการมาตรฐานของระบบ + รายการที่ admin เพิ่มเอง
function ChecklistItems({ settings, save }) {
  const { meta } = useApp();
  const [items, setItems] = useState(settings.requirement_items);
  useEffect(() => setItems(settings.requirement_items), [settings.requirement_items]);
  const set = (i, patch) => setItems(items.map((m, n) => (n === i ? { ...m, ...patch } : m)));
  const dirty = JSON.stringify(items) !== JSON.stringify(settings.requirement_items);
  const builtin = meta.requirement_options.filter((o) => !o.custom);

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>รายการที่เพิ่มเอง</h2>
          <p className="small muted">รายการที่เพิ่มจะไปแสดงในเช็คลิสต์ของหน้างานขายทันที · กำลังคน (man-day) ใช้คำนวณราคาเมื่อพนักงานขายติ๊กรายการนี้</p>
        </div>
        {items.length === 0 && <p className="muted">ยังไม่มีรายการที่เพิ่มเอง</p>}
        {items.map((m, i) => (
          <div key={i} className="stack" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16, gap: 10 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={m.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} placeholder="ชื่อรายการ เช่น ระบบสะสมแต้ม" aria-label="ชื่อรายการ" />
              <button className="btn ghost danger sm" onClick={() => setItems(items.filter((_, n) => n !== i))} aria-label="ลบรายการ"><Icon name="trash" /></button>
            </div>
            <input value={m.desc} maxLength={200} onChange={(e) => set(i, { desc: e.target.value })} placeholder="คำอธิบายสั้น ๆ ที่จะแสดงใต้ชื่อและในใบเสนอราคา" aria-label="คำอธิบาย" />
            <div className="row">
              <span className="small muted">กำลังคน (man-day):</span>
              {Object.entries(m.effort).map(([code, d]) => (
                <label key={code} className="row" style={{ gap: 4 }}>
                  <span className="small">{code}</span>
                  <input className="inline-input" type="number" min="0" step="0.5" style={{ width: 70 }} value={d} onChange={(e) => set(i, { effort: { ...m.effort, [code]: e.target.value } })} />
                </label>
              ))}
              <select className="inline-input" style={{ width: 'auto' }} value="" aria-label="เพิ่มตำแหน่ง" onChange={(e) => e.target.value && set(i, { effort: { ...m.effort, [e.target.value]: 1 } })}>
                <option value="">+ ตำแหน่ง</option>
                {meta.positions.filter((p) => !(p.code in m.effort)).map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
              </select>
              <span className="small muted">ใส่ 0 เพื่อเอาตำแหน่งออก</span>
            </div>
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setItems([...items, { id: '', title: '', desc: '', effort: { FE: 2, BE: 3, QA: 1 } }])}><Icon name="plus" />เพิ่มรายการ</button>
          <div style={{ flex: 1 }} />
          {dirty && <button className="btn" onClick={() => setItems(settings.requirement_items)}>ยกเลิก</button>}
          <button className="btn primary" disabled={!dirty} onClick={() => save('requirement_items', items)}>บันทึกเช็คลิสต์</button>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>รายการมาตรฐานของระบบ ({builtin.length})</h2><span className="small muted">แก้ไขไม่ได้</span></div>
        <div className="checklist">
          {builtin.map((o) => <div key={o.id} className="check" style={{ cursor: 'default' }}><span><b>{o.title}</b><small>{o.desc}</small></span></div>)}
        </div>
      </div>
    </div>
  );
}

const SYSTEM_STEP_IDS = ['draft', 'analyzed', 'quoted', 'won'];

// ขั้นตอนงานขาย: แก้ชื่อได้ทุกขั้น เพิ่ม/ลบ/เลื่อนได้เฉพาะขั้นที่เพิ่มเอง
function SalesSteps({ settings, save }) {
  const [steps, setSteps] = useState(settings.sales_steps);
  useEffect(() => setSteps(settings.sales_steps), [settings.sales_steps]);
  const isSystem = (s) => SYSTEM_STEP_IDS.includes(s.id);
  const set = (i, label) => setSteps(steps.map((s, n) => (n === i ? { ...s, label } : s)));
  const swap = (i, j) => {
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };
  // เลื่อนได้เฉพาะขั้นที่เพิ่มเอง และห้ามเลยขั้นปิดการขายซึ่งอยู่ท้ายสุด
  const canMove = (i, j) => !isSystem(steps[i]) && j >= 0 && j < steps.length - 1;
  const add = () => setSteps([...steps.slice(0, -1), { id: '', label: '' }, steps[steps.length - 1]]);
  const dirty = JSON.stringify(steps) !== JSON.stringify(settings.sales_steps);

  return (
    <div className="card stack">
      <div>
        <h2>ขั้นตอนงานขาย</h2>
        <p className="small muted">แถบขั้นตอนที่แสดงบนหน้างานขาย — แก้ชื่อได้ทุกขั้น และเพิ่มขั้นตอนของบริษัทเองได้ เช่น “นัดนำเสนอ” หรือ “ต่อรองราคา”</p>
      </div>
      {steps.map((s, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
          <span className="num muted" style={{ width: 22 }}>{i + 1}</span>
          <input value={s.label} maxLength={40} onChange={(e) => set(i, e.target.value)} placeholder="ชื่อขั้นตอน" aria-label={`ชื่อขั้นตอนที่ ${i + 1}`} />
          {isSystem(s) ? <span className="small muted nowrap" style={{ width: 196 }}>ขั้นตอนของระบบ</span> : (
            <span className="row nowrap" style={{ width: 196, gap: 4, flexWrap: 'nowrap' }}>
              <button className="btn sm ghost" disabled={!canMove(i, i - 1)} onClick={() => swap(i, i - 1)}>ขึ้น</button>
              <button className="btn sm ghost" disabled={!canMove(i, i + 1)} onClick={() => swap(i, i + 1)}>ลง</button>
              <button className="btn sm ghost danger" onClick={() => setSteps(steps.filter((_, n) => n !== i))} aria-label="ลบขั้นตอน"><Icon name="trash" /></button>
            </span>
          )}
        </div>
      ))}
      <div className="row">
        <button className="btn sm" disabled={steps.length >= 12} onClick={add}><Icon name="plus" />เพิ่มขั้นตอน</button>
        <div style={{ flex: 1 }} />
        {dirty && <button className="btn" onClick={() => setSteps(settings.sales_steps)}>ยกเลิก</button>}
        <button className="btn primary" disabled={!dirty} onClick={() => save('sales_steps', steps)}>บันทึกขั้นตอน</button>
      </div>
      <p className="small muted">
        ขั้นตอนของระบบ 4 ขั้นลบและสลับลำดับกันไม่ได้ เพราะผูกกับการวิเคราะห์ ออกใบเสนอราคา และปิดการขาย · ขั้นปิดการขายอยู่ท้ายสุดเสมอ ·
        ย้ายงานไปขั้นตอนใดก็ได้โดยกดที่ขั้นตอนนั้นบนหน้างานขาย
      </p>
    </div>
  );
}

// การเชื่อมต่ออีเมลแจ้งเตือน: ทุกการแจ้งเตือนในระบบจะส่งถึงอีเมลของสมาชิกด้วย
function EmailSettings({ settings, save }) {
  const { run, meta, user } = useApp();
  const [f, setF] = useState(settings.email);
  const [testing, setTesting] = useState(false);
  useEffect(() => setF(settings.email), [settings.email]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dirty = JSON.stringify(f) !== JSON.stringify(settings.email);

  const test = async () => {
    setTesting(true);
    const out = await run(() => api.post('/settings/email/test'));
    setTesting(false);
    if (out) window.alert(`ส่งอีเมลทดสอบไปที่ ${out.to} แล้ว กรุณาตรวจกล่องจดหมาย (และโฟลเดอร์สแปม)`);
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>เชื่อมต่ออีเมลแจ้งเตือน</h2>
            <p className="small muted">เมื่อเปิดใช้ ทุกการแจ้งเตือนในระบบจะส่งถึงอีเมลของสมาชิกแต่ละคนด้วย (ใช้อีเมลในเมนูสมาชิก)</p>
          </div>
          <Badge tone={meta.email_enabled ? 'ok' : ''}>{meta.email_enabled ? 'เปิดใช้อยู่' : 'ยังไม่เปิดใช้'}</Badge>
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(f.enabled)} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          เปิดส่งการแจ้งเตือนทางอีเมล
        </label>
        <div className="grid g2">
          <Field label="SMTP Host"><input value={f.host} onChange={set('host')} placeholder="smtp.gmail.com" /></Field>
          <Field label="พอร์ต (465 = SSL, 587 = STARTTLS)"><input type="number" min="1" max="65535" value={f.port} onChange={set('port')} /></Field>
          <Field label="ชื่อผู้ใช้ (อีเมลผู้ส่ง)"><input value={f.user} onChange={set('user')} autoComplete="off" placeholder="you@gmail.com" /></Field>
          <Field label={f.has_pass ? 'รหัสผ่าน (บันทึกไว้แล้ว — เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน / App Password'}>
            <input type="password" value={f.pass} onChange={set('pass')} autoComplete="new-password" placeholder={f.has_pass ? '••••••••' : ''} />
          </Field>
          <Field label="ชื่อและอีเมลผู้ส่งที่แสดง"><input value={f.from} onChange={set('from')} placeholder="Iterra <you@gmail.com>" /></Field>
          <Field label="ที่อยู่ของระบบ (ใช้ทำลิงก์ในอีเมล)"><input value={f.app_url} onChange={set('app_url')} placeholder="https://..." /></Field>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!dirty} onClick={() => save('email', f)}>บันทึก</button>
          <button className="btn" disabled={dirty || testing || !settings.email.host} onClick={test} title={dirty ? 'บันทึกก่อนทดสอบ' : ''}>
            {testing ? 'กำลังส่ง…' : `ส่งอีเมลทดสอบถึงฉัน (${user.email})`}
          </button>
        </div>
      </div>
      <div className="card">
        <h3>วิธีตั้งค่ากับ Gmail</h3>
        <ul className="plain">
          <li>SMTP Host: <b>smtp.gmail.com</b> · พอร์ต: <b>465</b></li>
          <li>ชื่อผู้ใช้: อีเมล Gmail ที่จะใช้ส่ง</li>
          <li>รหัสผ่าน: ต้องใช้ <b>App Password</b> 16 ตัว (สร้างที่ บัญชี Google → ความปลอดภัย → การยืนยันแบบ 2 ขั้นตอน → รหัสผ่านสำหรับแอป) ใช้รหัสผ่าน Gmail ปกติไม่ได้</li>
          <li>ผู้ให้บริการอื่น ให้ใช้ค่า SMTP ที่ผู้ให้บริการกำหนด</li>
        </ul>
        <p className="small muted" style={{ marginTop: 10 }}>สมาชิกที่อีเมลไม่ใช่อีเมลจริง (เช่น ลงท้ายด้วย @iterra.local) จะไม่ได้รับอีเมล แก้อีเมลได้ที่เมนูสมาชิก</p>
      </div>
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
        <button className="btn primary sm" onClick={() => setForm({ name: '', email: '', phone: '', avatar: '', password: '', role: 'staff', position: '' })}><Icon name="plus" />เพิ่มสมาชิก</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>เบอร์โทรศัพท์</th><th>สิทธิ์</th><th>ตำแหน่งงาน</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td><div className="name-cell"><Avatar user={u} size={36} />{u.name}</div></td>
                <td>{u.email}</td>
                <td className="num nowrap">{u.phone || '—'}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td>{meta.member_positions.find((p) => p.code === u.position)?.name ?? '—'}</td>
                <td><Badge tone={u.active ? 'ok' : ''}>{u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge></td>
                <td className="right nowrap">
                  <button className="btn sm ghost" onClick={() => setForm({ ...u, position: u.position ?? '', phone: u.phone ?? '', avatar: u.avatar ?? '', password: '' })}>แก้ไข</button>
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
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <span>ภาพสมาชิก</span>
              <PhotoPicker name={form.name} value={form.avatar} onChange={(avatar) => setForm({ ...form, avatar })} />
            </div>
            <Field label="ชื่อ"><input value={form.name} onChange={set('name')} autoFocus /></Field>
            <Field label="อีเมล"><input type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="เบอร์โทรศัพท์ (ตัวเลขไม่เกิน 10 หลัก)" style={{ gridColumn: '1 / -1' }}>
              <input type="tel" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: phoneDigits(e.target.value) })} />
            </Field>
            <Field label="สิทธิ์"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, position: e.target.value === 'sales' && !form.position ? 'SALE' : form.position })}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="ตำแหน่งงาน"><select value={form.position} onChange={set('position')}><option value="">—</option>{meta.member_positions.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={form.id ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)'} style={{ gridColumn: '1 / -1' }}>
              <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
