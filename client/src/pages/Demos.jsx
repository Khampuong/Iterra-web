import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, date, DEAL_STATUS } from '../lib.js';
import { Badge, Bar, Field, Icon, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import DealChat from '../components/DealChat.jsx';

const tone = (s) => (s >= 75 ? 'ok' : s >= 50 ? 'warn' : 'danger');

// รายการงานของทีมพัฒนา: งานที่ผู้ถือหุ้นส่งให้ → กดรับงาน → ประเมิน คุยงาน ส่งลิงก์ Demo
export function Demos() {
  const nav = useNavigate();
  const { user } = useApp();
  const [rows] = useData('/demos');
  const isAdmin = user.role === 'admin';
  const [onlyMine, setMine] = useState(!isAdmin);
  const list = (rows ?? []).filter((d) => !onlyMine || d.dev_id === user.id); // dev ได้รายการเฉพาะงานที่ส่งให้ตนเองอยู่แล้ว
  return (
    <>
      <PageHead eyebrow="ทีมพัฒนา" title="งาน dev" sub={isAdmin ? 'งานขายทั้งหมดและ dev ที่รับงาน' : 'งานที่ผู้ถือหุ้นส่งให้คุณ — กดรับงาน ประเมินความเป็นไปได้ คุยงาน และส่งลิงก์ Demo'} />
      {isAdmin && <label className="row" style={{ gap: 8, marginBottom: 14 }}><input type="checkbox" style={{ width: 'auto' }} checked={onlyMine} onChange={(e) => setMine(e.target.checked)} />เฉพาะงานที่ฉันรับ</label>}
      <div className="card flush">
        {rows && list.length === 0 ? <div className="empty">{isAdmin ? 'ยังไม่มีงานขาย' : 'ยังไม่มีงานที่ส่งให้คุณ — เมื่อผู้ถือหุ้นเลือกคุณเป็น dev ของงานใด งานนั้นจะขึ้นที่นี่และมีแจ้งเตือน'}</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>งาน</th><th>ลูกค้า</th><th>พนักงานขาย</th><th>dev</th><th>สถานะงานขาย</th><th>ลิงก์ Demo</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="link" onClick={() => nav(`/demos/${d.id}`)}>
                    <td>{d.title}<div className="small muted">{d.code}</div></td>
                    <td>{d.customer_company || d.customer_name}</td>
                    <td>{d.sales_name ?? '—'}</td>
                    <td>
                      {d.dev_name ?? <span className="muted">ยังไม่ได้เลือก</span>}
                      {d.dev_id && <div>{d.dev_accepted_at ? <Badge tone="ok">รับงานแล้ว</Badge> : <Badge tone="warn">รอกดรับงาน</Badge>}</div>}
                    </td>
                    <td><Badge tone={DEAL_STATUS[d.status].tone}>{DEAL_STATUS[d.status].label}</Badge></td>
                    <td>{d.demo_url ? <Badge tone="ok">ส่งแล้ว</Badge> : <span className="muted">ยังไม่ส่ง</span>}</td>
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

// หน้างานของ dev: กดรับงาน → ปรับประเมินความเป็นไปได้ → คุยกับพนักงานขาย → ส่งลิงก์ Demo
export default function DemoEditor() {
  const { id } = useParams();
  const { run, user } = useApp();
  const [deal, reload] = useData(`/demos/${id}`);
  const [link, setLink] = useState('');
  const [review, setReview] = useState({ technical_score: '', note: '' });

  useEffect(() => {
    if (!deal) return;
    setLink(deal.demo_url ?? '');
    setReview({ technical_score: deal.feasibility?.factors.find((f) => f.key === 'technical')?.score ?? '', note: deal.dev_review?.note ?? '' });
  }, [deal]);

  if (!deal) return null;
  const isAdmin = user.role === 'admin';
  const accepted = Boolean(deal.dev_accepted_at) || isAdmin;
  const fz = deal.feasibility;

  const accept = async () => {
    if (await run(() => api.post(`/demos/${id}/accept`), 'รับงานแล้ว — แจ้งพนักงานขายและผู้ถือหุ้นเรียบร้อย')) reload();
  };
  const saveReview = async () => {
    if (await run(() => api.put(`/demos/${id}/feasibility`, review), 'บันทึกการประเมินแล้ว — แจ้งพนักงานขายและผู้ถือหุ้นเรียบร้อย')) reload();
  };
  const saveLink = async (url) => {
    if (await run(() => api.put(`/demos/${id}/link`, { url }), url ? 'ส่งลิงก์ Demo แล้ว — แจ้งพนักงานขายเรียบร้อย' : 'ลบลิงก์แล้ว')) reload();
  };

  return (
    <>
      <PageHead eyebrow={<Link to="/demos">← งาน dev</Link>} title={deal.title} sub={`${deal.code} · ${deal.customer} · พนักงานขาย ${deal.sales_name ?? '—'} · dev ${deal.dev_name ?? 'ยังไม่ได้เลือก'}`}>
        {deal.dev_accepted_at ? <Badge tone="ok">รับงานแล้ว {date(deal.dev_accepted_at)}</Badge> : <Badge tone="warn">รอกดรับงาน</Badge>}
      </PageHead>

      {deal.is_dev && !deal.dev_accepted_at && (
        <div className="card row" style={{ justifyContent: 'space-between', marginBottom: 18, borderColor: 'var(--accent)' }}>
          <div>
            <h2>ผู้ถือหุ้นส่งงานนี้ให้คุณ</h2>
            <p className="small muted">ดู Requirement ด้านล่าง แล้วกดรับงานเพื่อเริ่มประเมินความเป็นไปได้ คุยงาน และส่งลิงก์ Demo</p>
          </div>
          <button className="btn primary" onClick={accept}><Icon name="check" />กดรับงาน</button>
        </div>
      )}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <h3>Requirement ของลูกค้า</h3>
            {deal.checklist.length > 0 && <p style={{ marginTop: 8 }}>{deal.checklist.map((c) => <span key={c} className="chip">{c}</span>)}</p>}
            <p className="small" style={{ color: 'var(--ink-2)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{deal.requirement || 'ไม่มีข้อมูลเพิ่มเติม'}</p>
            {deal.items.length > 0 && (
              <>
                <h3 style={{ marginTop: 14 }}>รายการงานจากการวิเคราะห์</h3>
                <ul className="plain">{deal.items.map((it, i) => <li key={i}>{it.title}{it.description && <span className="small muted"> — {it.description}</span>}</li>)}</ul>
              </>
            )}
          </div>

          <div className="card stack">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <h2>ประเมินความเป็นไปได้</h2>
              {fz && <Badge tone={tone(fz.score)}>{fz.label} · {fz.score}</Badge>}
            </div>
            {!fz ? <p className="muted">พนักงานขายยังไม่ได้วิเคราะห์ Requirement</p> : (
              <>
                {fz.factors.map((x) => (
                  <div key={x.key}>
                    <div className="row" style={{ justifyContent: 'space-between' }}><span>{x.label}</span><span className="num">{x.score}</span></div>
                    <Bar value={x.score} tone={tone(x.score)} />
                    <div className="small muted" style={{ marginTop: 3 }}>{x.note}</div>
                  </div>
                ))}
                {accepted ? (
                  <div className="stack" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
                    <div className="grid g2">
                      <Field label="ความเป็นไปได้ทางเทคนิค (0–100)">
                        <input type="number" min="0" max="100" value={review.technical_score} onChange={(e) => setReview({ ...review, technical_score: e.target.value })} />
                      </Field>
                    </div>
                    <Field label="เหตุผล / ข้อสังเกตจาก dev">
                      <textarea style={{ minHeight: 80 }} value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} placeholder="เช่น ต้องเชื่อม API ธนาคาร ใช้เวลาทดสอบเพิ่ม" />
                    </Field>
                    <div><button className="btn primary" onClick={saveReview}>บันทึกการประเมิน</button></div>
                  </div>
                ) : <p className="small muted">กดรับงานก่อนจึงปรับประเมินได้</p>}
              </>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>คุยงานกับพนักงานขาย</h3>
            <DealChat dealId={deal.id} />
          </div>

          <div className="card stack">
            <div>
              <h3>ส่งลิงก์ Demo ให้พนักงานขาย</h3>
              <p className="small muted">ลิงก์จะขึ้นที่แท็บ “ลิงก์ Demo” ของงานขาย ส่งเข้าห้องคุยงาน และแจ้งเตือนพนักงานขาย</p>
            </div>
            {accepted ? (
              <>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://demo.example.com" aria-label="ลิงก์ Demo" />
                  <button className="btn primary" disabled={!link.trim() || link.trim() === (deal.demo_url ?? '')} onClick={() => saveLink(link.trim())}>{deal.demo_url ? 'อัปเดตลิงก์' : 'ส่งลิงก์'}</button>
                  {deal.demo_url && <button className="btn ghost danger" onClick={() => saveLink('')}>ลบ</button>}
                </div>
                {deal.demo_url && <a href={deal.demo_url} target="_blank" rel="noopener noreferrer" className="small">ลิงก์ปัจจุบัน: {deal.demo_url}</a>}
              </>
            ) : <p className="small muted">กดรับงานก่อนจึงส่งลิงก์ได้</p>}
          </div>
        </div>
      </div>
    </>
  );
}
