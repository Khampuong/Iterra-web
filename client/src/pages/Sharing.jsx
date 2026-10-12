import { Link } from 'react-router-dom';
import { money, money2, PROJECT_STATUS } from '../lib.js';
import { Badge, Stat, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

export default function Sharing() {
  const [d] = useData('/sharing');
  if (!d) return null;
  const total = (k) => d.projects.reduce((s, p) => s + p[k], 0);
  const teamPaid = d.people.reduce((s, x) => s + x.paid, 0);
  const teamDue = d.people.reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <PageHead eyebrow="ขั้นที่ 4 · แบ่งผลประโยชน์" title="แบ่งผลประโยชน์ตามตำแหน่งงาน"
        sub={`คอมมิชชันฝ่ายขาย ${d.settings.sales_percent}% ของมูลค่างาน · หลังหักต้นทุน บริษัท ${d.settings.company_percent}% ทีม ${100 - d.settings.company_percent}% แบ่งตามสัดส่วนตำแหน่ง`} />

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <Stat hero label="ส่วนแบ่งทีมและฝ่ายขายทั้งหมด" value={money(teamDue)} hint={`จ่ายแล้ว ${money(teamPaid)} · ค้างจ่าย ${money(teamDue - teamPaid)}`} />
        <Stat label="มูลค่างานรวม" value={money(total('revenue'))} hint={`${d.projects.length} โครงการ`} />
        <Stat label="ต้นทุนตรงรวม" value={money(total('direct'))} />
        <Stat label="ส่วนของบริษัท" value={money(total('company'))} />
      </div>

      <div className="grid g-main">
        <div className="card flush">
          <div className="card-head"><h2>รายโครงการ</h2></div>
          {d.projects.length === 0 ? <div className="empty">ยังไม่มีโครงการ</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>โครงการ</th><th className="right">มูลค่างาน</th><th className="right">ต้นทุนตรง</th><th className="right">ฝ่ายขาย</th><th className="right">บริษัท</th><th className="right">ทีม</th></tr></thead>
                <tbody>
                  {d.projects.map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`}>{p.name}</Link><div className="small muted">{p.code} · <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge></div></td>
                      <td className="right num">{money2(p.revenue)}</td>
                      <td className="right num">{money2(p.direct)}</td>
                      <td className="right num">{money2(p.sales.amount)}</td>
                      <td className="right num">{money2(p.company)}</td>
                      <td className="right num">{money2(p.pool)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card flush">
          <div className="card-head"><h2>รายบุคคล</h2></div>
          {d.people.length === 0 ? <div className="empty">ยังไม่มีข้อมูล</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>ผู้รับ</th><th className="right">ส่วนแบ่ง</th><th className="right">ค้างจ่าย</th></tr></thead>
                <tbody>
                  {d.people.map((x, i) => (
                    <tr key={i}>
                      <td>{x.name}<div className="small muted">{x.positions.join(', ')} · {x.projects} รายการ</div></td>
                      <td className="right num">{money2(x.amount)}</td>
                      <td className="right num">{money2(x.amount - x.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>บันทึกการจ่ายส่วนแบ่งได้ที่แท็บ “ผลประโยชน์” ของแต่ละโครงการ</p>
    </>
  );
}
