import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, DEAL_STATUS } from '../lib.js';
import { Badge, Field, Icon, Tabs, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import DealChat from '../components/DealChat.jsx';

const SOURCE = { dev: 'ทีมพัฒนาแก้ไข', html: 'HTML ที่แก้เอง', claude: 'สร้างโดย Claude', fallback: 'แม่แบบพื้นฐาน' };

// รายการงานขายสำหรับทีมพัฒนา: เลือกงานเพื่อเพิ่มข้อมูลหน้า Demo
export function Demos() {
  const nav = useNavigate();
  const { user } = useApp();
  const [rows] = useData('/demos');
  const isAdmin = user.role === 'admin';
  const list = rows ?? []; // dev ได้รายการเฉพาะงานที่ผู้ถือหุ้นส่งให้ตนเอง
  return (
    <>
      <PageHead eyebrow="ทีมพัฒนา" title="หน้า Demo" sub={isAdmin ? 'เพิ่มและแก้ไขข้อมูลที่แสดงบนหน้า Demo ของแต่ละงานขาย' : 'งานที่ผู้ถือหุ้นส่งให้คุณ — เพิ่มข้อมูลหน้า Demo แนบลิงก์ และคุยงานกับพนักงานขาย'} />
      <label className="row" style={{ gap: 8, marginBottom: 14 }}><input type="checkbox" style={{ width: 'auto' }} checked={onlyMine} onChange={(e) => setMine(e.target.checked)} />เฉพาะงานที่ฉันรับ</label>
      <div className="card flush">
        {rows && list.length === 0 ? <div className="empty">{isAdmin ? 'ยังไม่มีงานขาย' : 'ยังไม่มีงานที่ส่งให้คุณ — เมื่อผู้ถือหุ้นเลือกคุณเป็น dev ของงานใด งานนั้นจะขึ้นที่นี่และมีแจ้งเตือน'}</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>งาน</th><th>ลูกค้า</th><th>พนักงานขาย</th><th>dev ที่รับงาน</th><th>สถานะงานขาย</th><th>หน้า Demo</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="link" onClick={() => nav(`/demos/${d.id}`)}>
                    <td>{d.title}<div className="small muted">{d.code}</div></td>
                    <td>{d.customer_company || d.customer_name}</td>
                    <td>{d.sales_name ?? '—'}</td>
                    <td>{d.dev_name ?? <span className="muted">ยังไม่ได้เลือก</span>}</td>
                    <td><Badge tone={DEAL_STATUS[d.status].tone}>{DEAL_STATUS[d.status].label}</Badge></td>
                    <td>{d.has_demo ? <Badge tone={d.demo_source === 'dev' || d.demo_source === 'html' ? 'ok' : 'blue'}>{SOURCE[d.demo_source] ?? 'มีแล้ว'}</Badge> : <span className="muted">ยังไม่มี</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ตัวแก้ไขรายการแบบซ้ำได้ (บริการ ตัวเลข ส่วนเนื้อหา ตาราง)
function Repeater({ title, hint, items, onChange, blank, max, children }) {
  const set = (i, patch) => onChange(items.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div><h3>{title}</h3>{hint && <p className="small muted">{hint}</p>}</div>
      {items.map((it, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <div className="stack" style={{ flex: 1, gap: 6, minWidth: 0 }}>{children(it, (patch) => set(i, patch))}</div>
          <button className="btn ghost danger sm" onClick={() => onChange(items.filter((_, n) => n !== i))} aria-label={`ลบ${title}`}><Icon name="trash" /></button>
        </div>
      ))}
      <div><button className="btn sm" disabled={items.length >= max} onClick={() => onChange([...items, blank])}><Icon name="plus" />เพิ่ม</button></div>
    </div>
  );
}

export default function DemoEditor() {
  const { id } = useParams();
  const { run } = useApp();
  const [deal, reload] = useData(`/demos/${id}`);
  const [mode, setMode] = useState('data');
  const [data, setData] = useState(null);
  const [html, setHtml] = useState('');
  const [preview, setPreview] = useState('');
  const [link, setLink] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!deal) return;
    setData(deal.data);
    setHtml(deal.demo_html ?? '');
    setPreview(deal.demo_html ?? '');
    setLink(deal.demo_url ?? '');
  }, [deal]);

  // โหมดข้อมูล: ขอหน้าตัวอย่างจากเซิร์ฟเวอร์หลังหยุดพิมพ์ครู่หนึ่ง · โหมด HTML: แสดงตามที่พิมพ์
  useEffect(() => {
    if (!data || mode !== 'data') return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.post(`/demos/${id}/preview`, { data }).then((r) => setPreview(r.html)).catch(() => {});
    }, 400);
    return () => clearTimeout(timer.current);
  }, [data, mode, id]);
  useEffect(() => {
    if (mode === 'html') setPreview(html);
  }, [html, mode]);

  if (!deal || !data) return null;
  const set = (patch) => setData({ ...data, ...patch });
  const input = (k, label, props = {}) => <Field label={label}><input value={data[k]} onChange={(e) => set({ [k]: e.target.value })} {...props} /></Field>;

  const saveLink = async (url) => {
    if (await run(() => api.put(`/demos/${id}/link`, { url }), url ? 'บันทึกลิงก์แล้ว — แจ้งพนักงานขายเรียบร้อย' : 'ลบลิงก์แล้ว')) reload();
  };
  const save = async () => {
    const body = mode === 'html' ? { mode: 'html', html } : { mode: 'data', data };
    if (await run(() => api.put(`/demos/${id}`, body), 'ส่งหน้า Demo ให้พนักงานขายแล้ว — พนักงานขายได้รับแจ้งเตือน')) reload();
  };

  return (
    <>
      <PageHead eyebrow={<Link to="/demos">← หน้า Demo</Link>} title={deal.title} sub={`${deal.code} · ${deal.customer} · พนักงานขาย ${deal.sales_name ?? '—'} · dev ${deal.dev_name ?? 'ยังไม่ได้เลือก'}`}>
        {deal.demo_source && <Badge tone="blue">{SOURCE[deal.demo_source] ?? deal.demo_source}</Badge>}
        <button className="btn primary" onClick={save}>บันทึกและส่ง Demo ให้พนักงานขาย</button>
      </PageHead>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <h3>Requirement ของลูกค้า</h3>
            {deal.checklist.length > 0 && <p style={{ marginTop: 8 }}>{deal.checklist.map((c) => <span key={c} className="chip">{c}</span>)}</p>}
            <p className="small" style={{ color: 'var(--ink-2)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{deal.requirement || 'ไม่มีข้อมูลเพิ่มเติม'}</p>
          </div>

          <div className="card stack">
            <div>
              <h3>ลิงก์หน้าเว็บ Demo สำหรับพนักงานขาย</h3>
              <p className="small muted">แนบลิงก์หน้าเว็บ Demo ที่ขึ้นไว้แล้ว ให้พนักงานขายเปิดดูก่อนนำไปเสนอลูกค้า</p>
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://demo.example.com" aria-label="ลิงก์ Demo" />
              <button className="btn primary" disabled={link.trim() === (deal.demo_url ?? '')} onClick={() => saveLink(link.trim())}>{deal.demo_url ? 'อัปเดตลิงก์' : 'บันทึกลิงก์'}</button>
              {deal.demo_url && <button className="btn ghost danger" onClick={() => saveLink('')}>ลบ</button>}
            </div>
            {deal.demo_url && <a href={deal.demo_url} target="_blank" rel="noopener noreferrer" className="small">เปิดลิงก์ปัจจุบัน: {deal.demo_url}</a>}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>คุยงานกับพนักงานขาย</h3>
            <DealChat dealId={deal.id} />
          </div>

          <div className="card">
            <Tabs value={mode} onChange={setMode} tabs={[['data', 'ข้อมูลหน้า Demo'], ['html', 'แก้ HTML เอง']]} />
            {mode === 'data' ? (
              <div className="stack">
                {input('brand', 'ชื่อแบรนด์ / ลูกค้า')}
                {input('headline', 'หัวข้อหลัก *')}
                <Field label="ข้อความแนะนำ"><textarea style={{ minHeight: 80 }} value={data.lead} onChange={(e) => set({ lead: e.target.value })} /></Field>
                {input('cta', 'ข้อความบนปุ่มหลัก')}

                <Repeater title="บริการ / ฟีเจอร์" items={data.services} onChange={(services) => set({ services })} blank={{ title: '', desc: '' }} max={12}>
                  {(s, up) => (<>
                    <input value={s.title} onChange={(e) => up({ title: e.target.value })} placeholder="ชื่อบริการ" aria-label="ชื่อบริการ" />
                    <input value={s.desc} onChange={(e) => up({ desc: e.target.value })} placeholder="คำอธิบาย" aria-label="คำอธิบายบริการ" />
                  </>)}
                </Repeater>

                <Repeater title="ตัวเลขเด่น" hint="เช่น 1,200+ ลูกค้า · แสดงใต้ส่วนนำ" items={data.stats} onChange={(stats) => set({ stats })} blank={{ value: '', label: '' }} max={6}>
                  {(s, up) => (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input style={{ width: 130 }} value={s.value} onChange={(e) => up({ value: e.target.value })} placeholder="ตัวเลข" aria-label="ตัวเลข" />
                      <input value={s.label} onChange={(e) => up({ label: e.target.value })} placeholder="คำอธิบาย" aria-label="คำอธิบายตัวเลข" />
                    </div>
                  )}
                </Repeater>

                <Repeater title="ตารางข้อมูล" hint="แสดงข้อมูลตัวอย่างของระบบ · คั่นคอลัมน์ด้วยจุลภาค (,) และขึ้นบรรทัดใหม่ต่อ 1 แถว" items={data.tables} onChange={(tables) => set({ tables })} blank={{ title: '', columns: '', rows: '' }} max={4}>
                  {(t, up) => (<>
                    <input value={t.title} onChange={(e) => up({ title: e.target.value })} placeholder="ชื่อตาราง เช่น รายการจองวันนี้" aria-label="ชื่อตาราง" />
                    <input value={t.columns} onChange={(e) => up({ columns: e.target.value })} placeholder="หัวคอลัมน์ เช่น รหัส, ชื่อ, สถานะ" aria-label="หัวคอลัมน์" />
                    <textarea style={{ minHeight: 90 }} value={t.rows} onChange={(e) => up({ rows: e.target.value })} placeholder={'B001, คุณสมชาย, ยืนยันแล้ว\nB002, คุณสมหญิง, รอชำระ'} aria-label="ข้อมูลในตาราง" />
                  </>)}
                </Repeater>

                <Repeater title="ส่วนเนื้อหาเพิ่มเติม" hint="หัวข้อพร้อมข้อความ เช่น เกี่ยวกับเรา หรือ เงื่อนไขการใช้บริการ" items={data.sections} onChange={(sections) => set({ sections })} blank={{ title: '', text: '' }} max={8}>
                  {(s, up) => (<>
                    <input value={s.title} onChange={(e) => up({ title: e.target.value })} placeholder="หัวข้อ" aria-label="หัวข้อส่วนเนื้อหา" />
                    <textarea style={{ minHeight: 90 }} value={s.text} onChange={(e) => up({ text: e.target.value })} placeholder="ข้อความ" aria-label="ข้อความส่วนเนื้อหา" />
                  </>)}
                </Repeater>

                <div className="stack" style={{ gap: 10 }}>
                  <h3>ข้อมูลติดต่อ</h3>
                  <div className="grid g2">
                    <input value={data.contact.phone} onChange={(e) => set({ contact: { ...data.contact, phone: e.target.value } })} placeholder="เบอร์โทรศัพท์" aria-label="เบอร์โทรศัพท์" />
                    <input value={data.contact.email} onChange={(e) => set({ contact: { ...data.contact, email: e.target.value } })} placeholder="อีเมล" aria-label="อีเมล" />
                  </div>
                  <input value={data.contact.address} onChange={(e) => set({ contact: { ...data.contact, address: e.target.value } })} placeholder="ที่อยู่" aria-label="ที่อยู่" />
                </div>
              </div>
            ) : (
              <div className="stack">
                <p className="small muted">วางหรือแก้โค้ด HTML ทั้งหน้าได้โดยตรง เมื่อบันทึกในโหมดนี้ หน้า Demo จะใช้ HTML นี้แทนหน้าที่สร้างจากข้อมูล</p>
                <textarea spellCheck={false} style={{ minHeight: 520, fontFamily: 'Consolas, monospace', fontSize: 12.5 }} value={html} onChange={(e) => setHtml(e.target.value)} aria-label="โค้ด HTML ของหน้า Demo" />
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 16 }}>
          <div className="card-head"><h2>ตัวอย่าง</h2><span className="small muted">ยังไม่ส่งจนกว่าจะกด “บันทึกและส่ง Demo”</span></div>
          <div className="browser">
            <div className="browser-bar"><span className="dots"><i /><i /><i /></span><span className="url">https://demo.{deal.code.toLowerCase()}.example</span></div>
            {/* แสดงใน iframe แบบ sandbox เพื่อไม่ให้โค้ดของหน้า Demo เข้าถึงระบบนี้ */}
            <iframe className="demo-frame" style={{ height: 'calc(100vh - 220px)', minHeight: 420 }} title="ตัวอย่างหน้า Demo" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview} />
          </div>
        </div>
      </div>
    </>
  );
}
