// ปฏิทินแผนงานของโครงการ — รูปแบบ สี และประเภทงานตามไฟล์ iterra-client-timeline.html
// รายการในปฏิทิน: ใช้ชุดที่บันทึกไว้ของโครงการ ถ้ายังไม่เคยบันทึก จะสร้างจากงานในระบบให้
// ทุกแถบมีคำกำกับ ไม่ใช้สีอย่างเดียว

export const TL_TYPES = {
  req: 'ข้อมูลที่ต้องได้จากลูกค้า',
  meet: 'นัดเข้าพบ',
  dev: 'พัฒนา',
  ops: 'ดำเนินการ',
  server: 'เซิร์ฟเวอร์',
  test: 'ทดสอบ',
  perf: 'ทดสอบ performance',
  ship: 'ส่งมอบ',
  mon: 'เฝ้าดูระบบ (monitor)',
};

const DOW = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

// วันที่แบบ UTC ทั้งหมด จะได้ไม่เลื่อนตามโซนเวลาเครื่องที่เปิด
const d = (s) => new Date(s + 'T00:00:00Z');
const iso = (x) => x.toISOString().slice(0, 10);
const add = (x, n) => new Date(x.getTime() + n * 864e5);
const dowIdx = (x) => (x.getUTCDay() + 6) % 7; // จันทร์ = 0
export const fmtDay = (s) => { const x = d(s); return `${DOW[dowIdx(x)]} ${x.getUTCDate()} ${MONTH[x.getUTCMonth()]}`; };

// ช่วงงานในระบบ -> ประเภทในปฏิทิน
const PHASE_TYPE = { requirement: 'ops', design: 'dev', development: 'dev', testing: 'test', deployment: 'server', support: 'mon' };

// แบ่งช่วงวันเป็นท่อนละสัปดาห์ เฉพาะจันทร์-ศุกร์ (งานในระบบนับวันทำการ)
function weekdaySegments(start, end) {
  const out = [];
  let segStart = null;
  for (let x = d(start); x <= d(end); x = add(x, 1)) {
    const wd = dowIdx(x) < 5;
    if (wd && !segStart) segStart = iso(x);
    const last = iso(x) === end || dowIdx(x) === 4;
    if (segStart && (last || !wd)) {
      out.push([segStart, wd ? iso(x) : iso(add(x, -1))]);
      segStart = null;
    }
  }
  return out;
}

// สร้างรายการปฏิทินตั้งต้นจากข้อมูลในระบบ: [เริ่ม, สิ้นสุด, ประเภท, ข้อความ]
export function generatePlan(p) {
  const groups = new Map();
  for (const t of p.tasks) {
    if (!t.start_date || !t.due_date) continue;
    const key = [t.phase, t.title, t.start_date, t.due_date].join('|');
    if (!groups.has(key)) groups.set(key, { start: t.start_date, end: t.due_date, type: PHASE_TYPE[t.phase] ?? 'dev', text: t.title });
  }
  const plan = [];
  for (const g of groups.values()) {
    for (const [a, b] of weekdaySegments(g.start, g.end)) plan.push([a, b, g.type, g.text]);
  }
  plan.push([p.start_date, p.start_date, 'ops', 'เริ่มโครงการ']);
  for (const m of p.milestones ?? []) plan.push([m.date, m.date, 'meet', m.title]);
  plan.push([p.end_date, p.end_date, 'ship', `ส่งมอบ${p.name}`]);
  return plan.sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]));
}

// รายการที่ใช้แสดง: ชุดที่บันทึกไว้ ถ้าไม่มีใช้ชุดที่สร้างจากระบบ
export function planOf(p) {
  return p.timeline?.items?.length ? p.timeline.items.map((i) => [i.start, i.end, i.type, i.text]) : generatePlan(p);
}

export function defaultIntro(p) {
  return `เริ่มงาน${fmtDay(p.start_date)} และส่งมอบ${p.name}${fmtDay(p.end_date)} งานแต่ละส่วนพัฒนาไปพร้อมกัน`;
}

const Chip = ({ e }) => <span className={`ev ${e[2]}`}>{e[3]}</span>;

// หมายเหตุ: ถ้าขึ้นต้นด้วย “หัวข้อ:” ให้หัวข้อเป็นตัวหนา เช่น “โดเมนและอีเมล: …”
function NoteLine({ line }) {
  const m = line.match(/^([^:]{1,40}):\s*(.*)$/);
  return m ? <p><b>{m[1]}:</b> {m[2]}</p> : <p>{line}</p>;
}

// ปฏิทินรายเดือน + รายการตามวันสำหรับจอแคบ
export function TimelineCalendar({ plan }) {
  if (!plan.length) return <p className="tl-intro">ยังไม่มีรายการในปฏิทิน</p>;
  const START = plan.reduce((m, e) => (e[0] < m ? e[0] : m), plan[0][0]);
  const END = plan.reduce((m, e) => (e[1] > m ? e[1] : m), plan[0][1]);
  const today = new Date().toLocaleDateString('sv-SE');
  const on = (day) => plan.filter(([a, b]) => a <= day && day <= b);

  const months = [];
  for (let m = new Date(Date.UTC(d(START).getUTCFullYear(), d(START).getUTCMonth(), 1)); m <= d(END); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) months.push(m);

  return months.map((first) => {
    const y = first.getUTCFullYear();
    const mo = first.getUTCMonth();
    // แสดงเฉพาะสัปดาห์ที่อยู่ในช่วงแผน ไม่วาดสัปดาห์ว่างหัวท้าย
    const from = new Date(Math.max(first, d(START)));
    const last = new Date(Math.min(new Date(Date.UTC(y, mo + 1, 0)), d(END)));
    const cells = DOW.map((n, i) => <div key={n} className={`dow${i === 5 ? ' sat' : ''}`}>{n}</div>);
    const agenda = [];
    for (let cur = add(from, -dowIdx(from)); cur <= last || dowIdx(cur) !== 0; cur = add(cur, 1)) {
      const day = iso(cur);
      const inRange = cur.getUTCMonth() === mo && day >= START && day <= END;
      const evs = inRange ? on(day) : [];
      const cls = ['day', !inRange && 'out', inRange && dowIdx(cur) === 5 && 'sat', day === today && 'today'].filter(Boolean).join(' ');
      cells.push(<div key={day} className={cls}><div className="num">{cur.getUTCDate()}</div>{evs.map((e, i) => <Chip key={i} e={e} />)}</div>);
      if (evs.length) {
        agenda.push(
          <li key={day}>
            <div className="d">{cur.getUTCDate()} {MONTH[mo]}<small>{DOW[dowIdx(cur)]}</small></div>
            <div>{evs.map((e, i) => <Chip key={i} e={e} />)}</div>
          </li>,
        );
      }
    }
    return (
      <section className="month" key={`${y}-${mo}`}>
        <p className="label">{y}</p>
        <h2>{MONTH_FULL[mo]} {y + 543}</h2>
        <div className="grid">{cells}</div>
        <ul className="agenda">{agenda}</ul>
      </section>
    );
  });
}

// ทั้งเอกสารตามไฟล์ต้นฉบับ: หัวเรื่อง คำนำ คำอธิบายสี ปฏิทิน ข้อมูลที่ต้องได้รับจากลูกค้า และหมายเหตุ
export default function ProjectTimeline({ p, plan = planOf(p) }) {
  const needs = plan.filter((e) => e[2] === 'req').sort((a, b) => a[0].localeCompare(b[0]));
  const notes = (p.timeline?.note ?? '').split(/\r?\n/).filter((l) => l.trim());
  return (
    <div className="tl">
      <p className="label">Timeline</p>
      <h1>ปฏิทินแผนงาน<br />{p.timeline?.title || p.name}</h1>
      <p className="intro">{p.timeline?.intro || defaultIntro(p)}</p>
      <ul className="key">{Object.entries(TL_TYPES).map(([t, name]) => <li key={t}><i className={t} />{name}</li>)}</ul>
      <TimelineCalendar plan={plan} />
      {needs.length > 0 && (
        <section className="needs">
          <p className="label">From the client</p>
          <h2>ข้อมูลที่ต้องได้รับจากลูกค้า</h2>
          <ul>{needs.map((e, i) => <li key={i}><b>{fmtDay(e[0])}</b><span>{e[3]}</span></li>)}</ul>
        </section>
      )}
      {notes.length > 0 && <footer>{notes.map((l, i) => <NoteLine key={i} line={l} />)}</footer>}
    </div>
  );
}
