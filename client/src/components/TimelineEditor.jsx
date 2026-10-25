import { useState } from 'react';
import { api } from '../lib.js';
import { Field, Icon, useApp } from './ui.jsx';
import ProjectTimeline, { defaultIntro, generatePlan, planOf, TL_TYPES } from './ProjectCalendar.jsx';

// แก้ไขปฏิทินแผนงานของโครงการ: รายการ [เริ่ม, สิ้นสุด, ประเภท, ข้อความ] คำนำ และหมายเหตุท้ายเอกสาร
export default function TimelineEditor({ p, onSaved, onCancel }) {
  const { run } = useApp();
  const [rows, setRows] = useState(() => planOf(p).map(([start, end, type, text]) => ({ start, end, type, text })));
  const [title, setTitle] = useState(p.timeline?.title || p.name);
  const [intro, setIntro] = useState(p.timeline?.intro || defaultIntro(p));
  const [note, setNote] = useState(p.timeline?.note ?? '');
  const set = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const regenerate = () => {
    if (!window.confirm('สร้างรายการใหม่จากงานในระบบ? รายการที่แก้ไว้จะถูกแทนที่')) return;
    setRows(generatePlan(p).map(([start, end, type, text]) => ({ start, end, type, text })));
  };
  const save = async () => {
    if (await run(() => api.put(`/projects/${p.id}/timeline`, { items: rows, title: title === p.name ? '' : title, intro, note }), 'บันทึกปฏิทินแผนงานแล้ว — แจ้งเตือนทีมของโครงการเรียบร้อย')) onSaved();
  };
  const sorted = [...rows].filter((r) => r.start && r.end && r.text).sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="stack">
      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>แก้ไขปฏิทินแผนงาน</h2>
            <p className="small muted">เพิ่มนัดลูกค้า ข้อมูลที่รอจากลูกค้า งานเซิร์ฟเวอร์ ทดสอบ performance หรือช่วงเฝ้าดูระบบได้ · ตัวอย่างด้านล่างเปลี่ยนตามทันที</p>
          </div>
          <div className="row">
            <button className="btn sm" onClick={regenerate}>สร้างใหม่จากงานในระบบ</button>
          </div>
        </div>
        <Field label="หัวเรื่อง (บรรทัดที่สองต่อจาก “ปฏิทินแผนงาน”)"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="คำนำใต้หัวเรื่อง"><textarea style={{ minHeight: 70 }} value={intro} onChange={(e) => setIntro(e.target.value)} /></Field>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 150 }}>เริ่ม</th><th style={{ width: 150 }}>สิ้นสุด</th><th style={{ width: 200 }}>ประเภท</th><th>ข้อความ</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input className="inline-input" type="date" value={r.start} onChange={(e) => set(i, { start: e.target.value, end: r.end < e.target.value ? e.target.value : r.end })} aria-label="วันเริ่ม" /></td>
                  <td><input className="inline-input" type="date" value={r.end} min={r.start} onChange={(e) => set(i, { end: e.target.value })} aria-label="วันสิ้นสุด" /></td>
                  <td>
                    <select className={`inline-input tl-type ${r.type}`} value={r.type} onChange={(e) => set(i, { type: e.target.value })} aria-label="ประเภท">
                      {Object.entries(TL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input className="inline-input" value={r.text} maxLength={120} onChange={(e) => set(i, { text: e.target.value })} aria-label="ข้อความ" /></td>
                  <td><button className="btn ghost danger sm" onClick={() => setRows(rows.filter((_, n) => n !== i))} aria-label="ลบรายการ"><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><button className="btn sm" onClick={() => setRows([...rows, { start: p.start_date, end: p.start_date, type: 'meet', text: '' }])}><Icon name="plus" />เพิ่มรายการ</button></div>
        <Field label="หมายเหตุท้ายเอกสาร (บรรทัดละ 1 ย่อหน้า)">
          <textarea style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โดเมนและอีเมล: … (ขึ้นต้นด้วยหัวข้อตามด้วย : จะแสดงหัวข้อเป็นตัวหนา)" />
        </Field>
        <div className="row">
          <button className="btn primary" onClick={save}>บันทึกปฏิทิน</button>
          <button className="btn" onClick={onCancel}>ยกเลิก</button>
        </div>
      </div>
      <div className="card">
        <ProjectTimeline p={{ ...p, timeline: { title, intro, note } }} plan={sorted.map((r) => [r.start, r.end, r.type, r.text])} />
      </div>
    </div>
  );
}
