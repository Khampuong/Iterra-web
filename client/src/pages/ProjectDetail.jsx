import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, date, money, money2, PROJECT_STATUS, TASK_STATUS, todayStr, WIDE } from '../lib.js';
import { Badge, Bar, Field, Icon, Modal, Stat, Tabs, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import ProjectTimeline from '../components/ProjectCalendar.jsx';
import TimelineEditor from '../components/TimelineEditor.jsx';

const dayNum = (s) => Date.parse(s + 'T00:00:00Z') / 86400000;

export default function ProjectDetail() {
  const { id } = useParams();
  const { user, run } = useApp();
  const [p, reload] = useData(`/projects/${id}`);
  const [tab, setTab] = useState('overview');
  const [editTimeline, setEditTimeline] = useState(false);
  if (!p) return null;
  const isAdmin = user.role === 'admin';
  const tabs = [['overview', 'ภาพรวม'], ['calendar', 'ปฏิทินแผนงาน'], ['tasks', `งาน (${p.tasks_done}/${p.tasks_total})`], ['team', 'ทีมและสัดส่วนงาน']];
  if (p.sharing) tabs.push(['sharing', 'ผลประโยชน์']);

  const setStatus = async (status) => {
    if (await run(() => api.put(`/projects/${id}`, { status }), 'อัปเดตสถานะแล้ว')) reload();
  };

  return (
    <>
      <PageHead eyebrow={<Link to="/projects">← โครงการ</Link>} title={p.name} sub={`${p.code} · ${p.customer} · ${date(p.start_date)} – ${date(p.end_date)}`}>
        {isAdmin ? (
          <select value={p.status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="สถานะโครงการ">
            {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        ) : <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>}
      </PageHead>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview p={p} showMoney={user.role !== 'staff'} />}
      {tab === 'calendar' && (editTimeline ? (
        <TimelineEditor p={p} onCancel={() => setEditTimeline(false)} onSaved={() => { setEditTimeline(false); reload(); }} />
      ) : (
        <div className="card">
          <div className="card-head">
            <p className="small muted">{p.timeline?.items ? 'ปฏิทินที่แก้ไขและบันทึกไว้ของโครงการนี้' : 'สร้างจากงาน วันครบกำหนดชำระ และวันส่งมอบในระบบ — กด “แก้ไขปฏิทิน” เพื่อเพิ่มนัดลูกค้าหรือข้อมูลที่รอจากลูกค้า'}</p>
            <div className="row">
              {isAdmin && <button className="btn" onClick={() => setEditTimeline(true)}>แก้ไขปฏิทิน</button>}
              <a className="btn primary" href={`/print/timeline/${p.id}`} target="_blank" rel="noreferrer"><Icon name="print" />พิมพ์ / ส่งให้ลูกค้า</a>
            </div>
          </div>
          <ProjectTimeline p={p} />
        </div>
      ))}
      {tab === 'tasks' && <Tasks p={p} reload={reload} />}
      {tab === 'team' && <Team p={p} reload={reload} isAdmin={isAdmin} />}
      {tab === 'sharing' && p.sharing && <SharingTab p={p} reload={reload} canPay={isAdmin} />}
    </>
  );
}

function Overview({ p, showMoney }) {
  const { meta } = useApp();
  const t0 = dayNum(p.start_date);
  const span = Math.max(1, dayNum(p.end_date) - t0);
  const pct = (s) => Math.max(0, Math.min(100, ((dayNum(s) - t0) / span) * 100));
  const today = todayStr();
  const showToday = today >= p.start_date && today <= p.end_date;
  const elapsed = Math.round(pct(today));

  return (
    <div className="stack">
      <div className="grid g4">
        <Stat hero label="ความคืบหน้ารวม" value={`${p.progress}%`} hint={`เวลาผ่านไป ${today < p.start_date ? 0 : elapsed}% ของแผน`} />
        <Stat label="งานเสร็จแล้ว" value={`${p.tasks_done}/${p.tasks_total}`} hint="ถ่วงน้ำหนักตาม man-day" />
        <Stat label="งานเลยกำหนด" value={p.tasks_overdue} hint={p.tasks_overdue ? 'ดูในแท็บ “งาน”' : 'อยู่ในกำหนดทั้งหมด'} />
        {showMoney ? <Stat label="มูลค่างาน (ก่อน VAT)" value={money(p.budget)} /> : <Stat label="วันส่งมอบ" value={date(p.end_date)} />}
      </div>

      <div className="card">
        <div className="card-head"><h2>แผนงานตามช่วง</h2><span className="small muted">แถบเข้ม = ความคืบหน้า · เส้นแดง = วันนี้</span></div>
        <div className="gantt">
          {p.phases.map((ph) => (
            <div key={ph.id} style={{ display: 'contents' }} title={`${ph.th}: ${date(ph.start)} – ${date(ph.due)} · ${ph.days} man-day`}>
              <div><div>{ph.name}</div><div className="small muted">{date(ph.start)} – {date(ph.due)}</div></div>
              <div className="track">
                <div className="seg" style={{ left: `${pct(ph.start)}%`, width: `${Math.max(1.5, pct(ph.due) - pct(ph.start))}%` }}><i style={{ width: `${ph.progress}%` }} /></div>
                {showToday && <div className="today" style={{ left: `${pct(today)}%` }} />}
              </div>
              <div className="num right">{ph.progress}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card flush">
        <div className="card-head"><h2>สัดส่วนงานตามตำแหน่ง</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ตำแหน่ง</th><th>ผู้รับผิดชอบ</th><th className="right">man-day</th><th className="right">% ของงาน</th><th style={{ width: '26%' }}>ความคืบหน้า</th></tr></thead>
            <tbody>
              {p.roles.map((r) => (
                <tr key={r.id}>
                  <td>{meta.positions.find((x) => x.code === r.position)?.name ?? r.position}<div className="small muted">{r.position}</div></td>
                  <td>{r.user_name ?? <span className="muted">ยังไม่ระบุ</span>}</td>
                  <td className="right num">{r.days}</td>
                  <td className="right num">{r.percent}%</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }}><div style={{ flex: 1 }}><Bar value={r.progress} tone={r.progress === 100 ? 'ok' : ''} /></div><span className="num small">{r.progress}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Tasks({ p, reload }) {
  const { user, meta, run } = useApp();
  const isAdmin = user.role === 'admin';
  const [mine, setMine] = useState(!WIDE.includes(user.role) && p.tasks.some((t) => t.assignee_id === user.id));
  const [form, setForm] = useState(null);
  const today = todayStr();

  const update = async (t, patch) => {
    if (await run(() => api.put(`/projects/${p.id}/tasks/${t.id}`, patch))) reload();
  };
  // ฟอร์มเดียวใช้ทั้งเพิ่มงานใหม่และแก้ไขงานเดิม (มี id = แก้ไข)
  const add = async () => {
    const call = form.id ? () => api.put(`/projects/${p.id}/tasks/${form.id}`, form) : () => api.post(`/projects/${p.id}/tasks`, form);
    if (await run(call, form.id ? 'แก้ไขงานแล้ว' : 'เพิ่มงานแล้ว')) {
      setForm(null);
      reload();
    }
  };
  const remove = async (t) => {
    if (window.confirm(`ลบงาน “${t.title}” ?`) && (await run(() => api.del(`/projects/${p.id}/tasks/${t.id}`)))) reload();
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={mine} onChange={(e) => setMine(e.target.checked)} />เฉพาะงานของฉัน</label>
        {isAdmin && <button className="btn" onClick={() => setForm({ title: '', phase: 'development', position: '', assignee_id: '', start_date: p.start_date, due_date: p.end_date, weight: 1 })}><Icon name="plus" />เพิ่มงาน</button>}
      </div>
      {meta.phases.map((ph) => {
        const list = p.tasks.filter((t) => t.phase === ph.id && (!mine || t.assignee_id === user.id));
        if (!list.length) return null;
        return (
          <div className="card flush" key={ph.id}>
            <div className="card-head"><h2>{ph.name} <span className="small muted">· {ph.th}</span></h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>งาน</th><th>ผู้รับผิดชอบ</th><th>กำหนดส่ง</th><th>สถานะ</th><th style={{ width: 190 }}>ความคืบหน้า</th>{isAdmin && <th />}</tr></thead>
                <tbody>
                  {list.map((t) => {
                    const can = isAdmin || t.assignee_id === user.id;
                    const late = t.status !== 'done' && t.due_date < today;
                    return (
                      <tr key={t.id}>
                        <td>{t.title}<div className="small muted">{t.position ?? '—'} · {t.weight} man-day</div></td>
                        <td>
                          {isAdmin ? (
                            <select className="inline-input" value={t.assignee_id ?? ''} onChange={(e) => update(t, { assignee_id: e.target.value || null })} aria-label="ผู้รับผิดชอบ">
                              <option value="">ยังไม่ระบุ</option>
                              {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.position ? ` (${u.position})` : ''}</option>)}
                            </select>
                          ) : (t.assignee_name ?? <span className="muted">ยังไม่ระบุ</span>)}
                        </td>
                        <td className="nowrap" style={{ color: late ? 'var(--danger)' : undefined }}>{date(t.due_date)}{late && <div className="small">เลยกำหนด</div>}</td>
                        <td>
                          <select className="inline-input" value={t.status} disabled={!can} onChange={(e) => update(t, { status: e.target.value })} aria-label="สถานะ">
                            {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td>
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <input type="range" min="0" max="100" step="10" defaultValue={t.progress} key={t.progress} disabled={!can} aria-label="ความคืบหน้า"
                              onMouseUp={(e) => Number(e.target.value) !== t.progress && update(t, { progress: e.target.value })}
                              onTouchEnd={(e) => Number(e.target.value) !== t.progress && update(t, { progress: e.target.value })}
                              onKeyUp={(e) => Number(e.target.value) !== t.progress && update(t, { progress: e.target.value })} />
                            <span className="num small" style={{ width: 36, textAlign: 'right' }}>{t.progress}%</span>
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="nowrap right">
                            <button className="btn ghost sm" onClick={() => setForm({ id: t.id, title: t.title, phase: t.phase, position: t.position ?? '', assignee_id: t.assignee_id ?? '', start_date: t.start_date ?? '', due_date: t.due_date ?? '', weight: t.weight })}>แก้ไข</button>
                            <button className="btn ghost danger sm" onClick={() => remove(t)} aria-label="ลบงาน"><Icon name="trash" /></button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {mine && !p.tasks.some((t) => t.assignee_id === user.id) && <div className="card empty">ยังไม่มีงานที่มอบหมายให้คุณในโครงการนี้</div>}

      {form && (
        <Modal title={form.id ? 'แก้ไขงาน' : 'เพิ่มงาน'} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn primary" onClick={add}>{form.id ? 'บันทึก' : 'เพิ่มงาน'}</button></>}>
          <div className="stack">
            <Field label="ชื่องาน"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
            <div className="grid g2">
              <Field label="ช่วงงาน"><select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>{meta.phases.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              <Field label="ตำแหน่ง"><select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}><option value="">—</option>{meta.positions.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}</select></Field>
              <Field label="ผู้รับผิดชอบ"><select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}><option value="">ยังไม่ระบุ</option>{meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="น้ำหนักงาน (man-day)"><input type="number" min="0.5" step="0.5" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></Field>
              <Field label="เริ่ม"><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
              <Field label="กำหนดส่ง"><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Team({ p, reload, isAdmin }) {
  const { meta, run } = useApp();
  const [rows, setRows] = useState(null);
  const [salesPct, setSalesPct] = useState(null); // null = ยังไม่ได้แก้
  const list = rows ?? p.roles;
  const dirty = rows !== null || salesPct !== null;
  const cancel = () => { setRows(null); setSalesPct(null); };
  const set = (id, patch) => setRows(list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const sum = (k) => Math.round(list.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 10) / 10;

  const save = async () => {
    const body = salesPct === null ? { roles: list } : { roles: list, sales_percent: salesPct };
    if (await run(() => api.put(`/projects/${p.id}/roles`, body), 'บันทึกทีมและสัดส่วนแล้ว')) {
      cancel();
      reload();
    }
  };

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          <h2>ทีมและสัดส่วนงานตามตำแหน่ง</h2>
          <p className="small muted">% งาน คำนวณจาก man-day ในใบเสนอราคา · % ผลประโยชน์ ใช้แบ่งส่วนของทีม (ปรับแยกจาก % งานได้) · พนักงานขายคิดเป็น % ของมูลค่างาน แยกจากส่วนของทีม</p>
        </div>
        {dirty && <div className="row"><button className="btn sm" onClick={cancel}>ยกเลิก</button><button className="btn primary sm" onClick={save}>บันทึก</button></div>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ตำแหน่ง</th><th>ผู้รับผิดชอบ</th><th className="right">man-day</th><th className="right" style={{ width: 130 }}>% งาน</th><th className="right" style={{ width: 150 }}>% ผลประโยชน์</th></tr></thead>
          <tbody>
            <tr>
              <td>พนักงานขาย<div className="small muted">SALE · ผู้ปิดการขาย</div></td>
              <td>{p.sales?.user_name ?? <span className="muted">ยังไม่ระบุ</span>}</td>
              <td className="right muted">—</td>
              <td className="right muted">—</td>
              <td className="right num">
                {p.sales?.percent == null ? <span className="muted">—</span> : isAdmin ? (
                  <input className="inline-input" type="number" min="0" max="100" step="0.1" value={salesPct ?? p.sales.percent} onChange={(e) => setSalesPct(e.target.value)} aria-label="% ผลประโยชน์พนักงานขาย" />
                ) : `${p.sales.percent}%`}
                {p.sales?.percent != null && <div className="small muted">ของมูลค่างาน</div>}
              </td>
            </tr>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{meta.positions.find((x) => x.code === r.position)?.name ?? r.position}<div className="small muted">{r.position}</div></td>
                <td>
                  {isAdmin ? (
                    <select className="inline-input" value={r.user_id ?? ''} onChange={(e) => set(r.id, { user_id: e.target.value ? Number(e.target.value) : null })} aria-label="ผู้รับผิดชอบ">
                      <option value="">ยังไม่ระบุ</option>
                      {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.position ? ` (${u.position})` : ''}</option>)}
                    </select>
                  ) : (r.user_name ?? <span className="muted">ยังไม่ระบุ</span>)}
                </td>
                <td className="right num">{r.days}</td>
                <td className="right num">{isAdmin ? <input className="inline-input" type="number" min="0" step="0.1" value={r.percent} onChange={(e) => set(r.id, { percent: e.target.value })} aria-label="% งาน" /> : `${r.percent}%`}</td>
                <td className="right num">{isAdmin ? <input className="inline-input" type="number" min="0" step="0.1" value={r.share_percent} onChange={(e) => set(r.id, { share_percent: e.target.value })} aria-label="% ผลประโยชน์" /> : `${r.share_percent}%`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>รวมทีม (ไม่รวมพนักงานขาย)</td><td className="right num">{sum('days')}</td><td className="right num">{sum('percent')}%</td><td className="right num">{sum('share_percent')}%</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function SharingTab({ p, reload, canPay }) {
  const { run } = useApp();
  const s = p.sharing;
  const [pay, setPay] = useState(null); // { role_id, label, max, amount, date }

  const submit = async () => {
    if (await run(() => api.post(`/projects/${p.id}/payout`, pay), 'บันทึกการจ่ายแล้ว')) {
      setPay(null);
      reload();
    }
  };
  const row = (key, label, who, pct, x) => {
    const left = Math.max(0, Math.round((x.amount - x.paid) * 100) / 100);
    return (
      <tr key={key}>
        <td>{label}</td>
        <td>{who ?? <span className="muted">ยังไม่ระบุ</span>}</td>
        <td className="right num">{pct}</td>
        <td className="right num">{money2(x.amount)}</td>
        <td className="right num">{money2(x.paid)}</td>
        <td className="right num">{money2(left)}</td>
        <td className="right">{canPay && left > 0 && <button className="btn sm" onClick={() => setPay({ role_id: x.role_id ?? x.id, label, max: left, amount: left, date: todayStr() })}>บันทึกจ่าย</button>}</td>
      </tr>
    );
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h2>ที่มาของยอดจัดสรร</h2><span className="small muted">รับชำระแล้ว {money(s.received)} จาก {money(s.revenue)}</span></div>
        <dl className="kv" style={{ maxWidth: 520 }}>
          <dt>มูลค่างาน (ก่อน VAT)</dt><dd>{money2(s.revenue)}</dd>
          <dt>หัก ต้นทุนตรงของโครงการ</dt><dd>−{money2(s.direct)}</dd>
          <dt>หัก ค่าคอมมิชชันฝ่ายขาย {s.sales_percent}%</dt><dd>−{money2(s.sales.amount)}</dd>
          <dt className="total">ยอดจัดสรร</dt><dd className="total">{money2(s.distributable)}</dd>
          <dt>ส่วนของบริษัท {s.company_percent}%</dt><dd>{money2(s.company)}</dd>
          <dt>ส่วนของทีม {100 - s.company_percent}%</dt><dd>{money2(s.pool)}</dd>
        </dl>
        <p className="small muted" style={{ marginTop: 12 }}>ต้นทุนตรง = รายจ่ายของโครงการในเมนู “รายรับรายจ่าย” (ไม่นับการจ่ายส่วนแบ่ง) · ปรับอัตราได้ในเมนู “ตั้งค่า”</p>
      </div>
      <div className="card flush">
        <div className="card-head"><h2>ส่วนแบ่งตามตำแหน่ง</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ตำแหน่ง</th><th>ผู้รับ</th><th className="right">สัดส่วน</th><th className="right">ส่วนแบ่ง</th><th className="right">จ่ายแล้ว</th><th className="right">คงเหลือ</th><th /></tr></thead>
            <tbody>
              {row('sales', 'ฝ่ายขาย (คอมมิชชัน)', s.sales.user_name, `${s.sales_percent}% ของมูลค่างาน`, s.sales)}
              {s.roles.map((r) => row(r.id, r.position, r.user_name, `${r.share_normalized}%`, r))}
            </tbody>
          </table>
        </div>
      </div>
      {pay && (
        <Modal title={`บันทึกจ่าย — ${pay.label}`} onClose={() => setPay(null)} footer={<><button className="btn" onClick={() => setPay(null)}>ยกเลิก</button><button className="btn primary" onClick={submit}>บันทึก</button></>}>
          <div className="grid g2">
            <Field label={`จำนวนเงิน (สูงสุด ${money2(pay.max)})`}><input type="number" min="0" max={pay.max} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="วันที่จ่าย"><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>ระบบจะบันทึกเป็นรายจ่ายหมวด “ส่วนแบ่งผลประโยชน์” ของโครงการนี้</p>
        </Modal>
      )}
    </div>
  );
}
