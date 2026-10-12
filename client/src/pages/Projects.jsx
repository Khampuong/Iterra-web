import { useNavigate } from 'react-router-dom';
import { date, money, PROJECT_STATUS } from '../lib.js';
import { Badge, Bar, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

export default function Projects() {
  const { user } = useApp();
  const nav = useNavigate();
  const [projects] = useData('/projects');
  const showMoney = user.role !== 'staff';

  return (
    <>
      <PageHead eyebrow="ขั้นที่ 2–3 · จัดโครงสร้างและติดตามงาน" title="โครงการ" sub="โครงการถูกเปิดอัตโนมัติเมื่อปิดการขาย พร้อมแบ่งงานตามตำแหน่งและกำหนดเวลา" />
      <div className="card flush">
        {projects && projects.length === 0 ? <div className="empty">ยังไม่มีโครงการ — โครงการจะถูกสร้างเมื่อปิดการขายในเมนู “งานขาย”</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>โครงการ</th><th>สถานะ</th><th style={{ width: '24%' }}>ความคืบหน้า</th><th>งาน</th><th>เริ่ม – ส่งมอบ</th>{showMoney && <th className="right">มูลค่า</th>}</tr>
              </thead>
              <tbody>
                {(projects ?? []).map((p) => (
                  <tr key={p.id} className="link" onClick={() => nav(`/projects/${p.id}`)}>
                    <td>{p.name}<div className="small muted">{p.code} · {p.customer}</div></td>
                    <td><Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge></td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div style={{ flex: 1 }}><Bar value={p.progress} tone={p.status === 'done' ? 'ok' : p.tasks_overdue ? 'warn' : ''} /></div>
                        <span className="num small">{p.progress}%</span>
                      </div>
                    </td>
                    <td className="nowrap num">{p.tasks_done}/{p.tasks_total}{p.tasks_overdue > 0 && <span style={{ color: 'var(--danger)' }}> · เลย {p.tasks_overdue}</span>}</td>
                    <td className="nowrap">{date(p.start_date)} – {date(p.end_date)}</td>
                    {showMoney && <td className="right num">{money(p.budget)}</td>}
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
