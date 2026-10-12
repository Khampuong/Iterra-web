import { Link } from 'react-router-dom';
import { date, DEAL_STATUS, money, TASK_STATUS } from '../lib.js';
import { Bar, Stat, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { HBars, MonthlyBars } from '../components/charts.jsx';

export default function Dashboard() {
  const { user } = useApp();
  const [d] = useData('/dashboard');
  if (!d) return null;
  const fin = d.finance;

  return (
    <>
      <PageHead eyebrow="ภาพรวม" title={`สวัสดี ${user.name}`} sub="สถานะงานขาย โครงการ และการเงินล่าสุด" />

      <div className="grid g4" style={{ marginBottom: 18 }}>
        {fin ? (
          <Stat hero label="กำไรสุทธิเดือนนี้" value={money(fin.net)} hint={`รายรับ ${money(fin.income)} · รายจ่าย ${money(fin.expense)}`} />
        ) : (
          <Stat hero label="งานของฉันที่ยังไม่เสร็จ" value={d.tasks.length} hint="เรียงตามวันครบกำหนด" />
        )}
        {<Stat label="มูลค่างานที่กำลังเสนอ" value={money(d.open_value)} hint={d.win_rate == null ? 'ยังไม่มีงานที่ปิด' : `อัตราปิดการขาย ${d.win_rate}%`} />}
        <Stat label="โครงการที่กำลังทำ" value={d.counts.active} hint={`เสร็จแล้ว ${d.counts.done} โครงการ`} />
        {fin
          ? <Stat label="ลูกหนี้รอรับชำระ" value={money(fin.receivable)} hint="ยอดก่อน VAT ตามใบแจ้งหนี้" />
          : <Stat label="งานเลยกำหนด" value={d.counts.overdue_tasks} hint={d.counts.overdue_tasks ? 'ควรติดตามทันที' : 'ทุกงานอยู่ในกำหนด'} />}
      </div>

      <div className="grid g-main" style={{ marginBottom: 18 }}>
        {fin ? (
          <div className="card">
            <div className="card-head"><h2>รายรับและรายจ่าย 6 เดือนล่าสุด</h2><Link to="/finance" className="small">ดูรายการทั้งหมด</Link></div>
            <MonthlyBars data={fin.monthly} />
          </div>
        ) : (
          <TaskCard tasks={d.tasks} />
        )}
        {(
          <div className="card">
            <div className="card-head"><h2>งานขายตามสถานะ</h2><Link to="/deals" className="small">งานขายทั้งหมด</Link></div>
            <HBars rows={d.pipeline.map((p) => ({ label: DEAL_STATUS[p.status].label, count: p.count, value: p.value }))} />
            <p className="small muted" style={{ marginTop: 14 }}>มูลค่าก่อน VAT · ตัวเลขหลังชื่อคือจำนวนงาน</p>
          </div>
        )}
      </div>

      <div className="grid g-main">
        <div className="card flush">
          <div className="card-head">
            <h2>ความคืบหน้าโครงการ{d.counts.overdue_tasks > 0 && <span className="small muted"> · งานเลยกำหนด {d.counts.overdue_tasks}</span>}</h2>
            <Link to="/projects" className="small">โครงการทั้งหมด</Link>
          </div>
          {d.projects.length === 0 ? <div className="empty">ยังไม่มีโครงการที่กำลังทำ</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>โครงการ</th><th style={{ width: '32%' }}>ความคืบหน้า</th><th>ส่งมอบ</th><th className="right">เหลือ</th></tr></thead>
                <tbody>
                  {d.projects.map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`}>{p.name}</Link><div className="small muted">{p.code} · {p.customer}</div></td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <div style={{ flex: 1 }}><Bar value={p.progress} tone={p.tasks_overdue ? 'warn' : ''} /></div>
                          <span className="num small">{p.progress}%</span>
                        </div>
                      </td>
                      <td className="nowrap">{date(p.end_date)}</td>
                      <td className="right nowrap num" style={{ color: p.days_left < 0 ? 'var(--danger)' : undefined }}>
                        {p.days_left < 0 ? `เกิน ${-p.days_left} วัน` : `${p.days_left} วัน`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {fin && <TaskCard tasks={d.tasks} />}
      </div>
    </>
  );
}

function TaskCard({ tasks }) {
  return (
    <div className="card">
      <div className="card-head"><h2>งานใกล้ครบกำหนด</h2></div>
      {tasks.length === 0 ? <div className="empty">ไม่มีงานค้าง</div> : (
        <ul className="list">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link to={`/projects/${t.project_id}`}>{t.title}</Link>
              <div className="small muted">{t.project_code} · {t.position ?? '—'} · {TASK_STATUS[t.status]} {t.progress}% · ครบกำหนด {date(t.due_date)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
