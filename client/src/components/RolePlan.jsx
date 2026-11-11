import { useEffect, useState } from 'react';
import { api, money, money2 } from '../lib.js';

const days = (d) => Number(d || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 });

// ประเมินเบื้องต้นระหว่างเลือก Requirement: ตำแหน่งที่เกี่ยวข้องและราคาประมาณ (อัปเดตตามที่ติ๊ก)
export function RolePreview({ title, checks, requirement }) {
  const [plan, setPlan] = useState(null);
  const key = JSON.stringify([checks, requirement]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.post('/deals/plan-preview', { title, requirement_checks: checks, requirement }).then(setPlan).catch(() => setPlan(null));
    }, 400);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan) return null;
  if (!plan.roles.length) return <div className="notice info">ติ๊กเช็คลิสต์หรือกรอกข้อมูลเพิ่มเติม ระบบจะวิเคราะห์ว่างานนี้ต้องใช้ตำแหน่งใดและประเมินราคาเบื้องต้นให้</div>;
  return (
    <div className="role-preview">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b>ตำแหน่งที่เกี่ยวข้องกับงานนี้</b>
        <span className="small muted">ใช้ {plan.roles.length} จาก {plan.total_positions} ตำแหน่ง · {days(plan.days)} man-day · ประมาณ <b className="num">{money(plan.net)}</b> ก่อน VAT</span>
      </div>
      <div className="role-chips">
        {plan.roles.map((r) => (
          <span key={r.code} className="role-chip" title={r.reason}>
            <b>{r.code}</b> {r.th} <span className="muted">· {days(r.days)} วัน</span>
          </span>
        ))}
      </div>
      <div className="small muted">ประเมินเบื้องต้นจากเช็คลิสต์ — กด “วิเคราะห์ Requirement” เพื่อแตกรายการงานและคำนวณราคาละเอียด (ชี้ที่ตำแหน่งเพื่อดูเหตุผล)</div>
    </div>
  );
}

// ตำแหน่งที่ใช้ในรายการงานปัจจุบัน พร้อมเหตุผล
export function RoleTable({ roles, showCost }) {
  if (!roles?.length) return null;
  return (
    <div className="card flush">
      <div className="card-head">
        <div><h2>ตำแหน่งที่เกี่ยวข้องกับงานนี้</h2><p className="small muted">ระบบเลือกเฉพาะตำแหน่งที่งานต้องใช้ แล้วคำนวณราคาจากกำลังคนของตำแหน่งเหล่านั้น</p></div>
        <span className="small muted">{roles.length} ตำแหน่ง</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ตำแหน่ง</th><th>ทำอะไรในงานนี้</th><th className="right">man-day</th>{showCost && <th className="right">ต้นทุนค่าแรง</th>}</tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.code}>
                <td className="nowrap"><b>{r.code}</b> <span className="small muted">{r.th}</span></td>
                <td className="small">{r.reason}</td>
                <td className="right num">{days(r.days)}</td>
                {showCost && <td className="right num">{money2(r.cost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
