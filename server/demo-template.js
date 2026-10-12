// หน้าเว็บ Demo เบื้องต้นแบบสำเร็จรูป
// สร้างจาก "ข้อมูลหน้า Demo" (demo_data) ที่ทีมพัฒนาแก้ไขได้ ถ้ายังไม่มีจะตั้งต้นจากรายการงานของงานขาย
// ใช้ทั้งเมื่อเรียก Claude API ไม่ได้ และเมื่อทีมพัฒนาบันทึกข้อมูลหน้า Demo เอง

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// รายการที่เป็นงานภายในหรือบริการเสริม ไม่นำไปแสดงเป็นบริการบนหน้าเว็บของลูกค้า
const INTERNAL = /Requirement|วิเคราะห์และออกแบบ|ทดสอบระบบ|นำขึ้นใช้งาน|ขึ้น Server|จด Domain|Service ดูแลระบบ/;

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, map) => (Array.isArray(v) ? v.slice(0, max).map(map) : []);

// ข้อมูลตั้งต้นของหน้า Demo จากงานขายและรายการงาน
export function defaultDemoData(deal, items) {
  const features = items.filter((i) => !INTERNAL.test(i.title));
  return {
    brand: deal.customer_company || deal.customer_name || '',
    headline: deal.title,
    lead: (deal.requirement || '').trim().split(/\r?\n/)[0].slice(0, 180) || 'บริการครบในที่เดียว ใช้งานง่าย สะดวกทั้งบนคอมพิวเตอร์และมือถือ',
    cta: 'เริ่มใช้งาน',
    services: (features.length ? features : items).slice(0, 9).map((f) => ({ title: f.title, desc: f.description || '' })),
    stats: [],
    sections: [],
    tables: [],
    contact: { phone: deal.customer_phone || '', email: deal.customer_email || '', address: deal.customer_address || '' },
  };
}

// ตรวจและตัดความยาวข้อมูลที่ทีมพัฒนาส่งมา
export function cleanDemoData(d) {
  return {
    brand: str(d?.brand, 80),
    headline: str(d?.headline, 120),
    lead: str(d?.lead, 400),
    cta: str(d?.cta, 40),
    services: list(d?.services, 12, (s) => ({ title: str(s?.title, 80), desc: str(s?.desc, 240) })).filter((s) => s.title),
    stats: list(d?.stats, 6, (s) => ({ label: str(s?.label, 60), value: str(s?.value, 30) })).filter((s) => s.label && s.value),
    sections: list(d?.sections, 8, (s) => ({ title: str(s?.title, 100), text: str(s?.text, 2000) })).filter((s) => s.title || s.text),
    tables: list(d?.tables, 4, (t) => ({ title: str(t?.title, 100), columns: str(t?.columns, 300), rows: str(t?.rows, 6000) })).filter((t) => t.columns),
    contact: { phone: str(d?.contact?.phone, 30), email: str(d?.contact?.email, 120), address: str(d?.contact?.address, 300) },
  };
}

const cells = (line) => line.split(',').map((c) => c.trim());

export function renderDemo(data, title = '') {
  const d = cleanDemoData(data);
  const brand = esc(d.brand);
  const has = { services: d.services.length > 0, stats: d.stats.length > 0, data: d.tables.length > 0, more: d.sections.length > 0 };

  const cards = d.services.map((f, i) => `
      <article class="card">
        <span class="no">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.desc)}</p>
      </article>`).join('');

  const stats = d.stats.map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('');

  const tables = d.tables.map((t) => {
    const cols = cells(t.columns);
    const rows = t.rows.split(/\r?\n/).filter((l) => l.trim()).slice(0, 60).map(cells);
    return `
    <div class="tablebox">
      ${t.title ? `<h3>${esc(t.title)}</h3>` : ''}
      <div class="scroll"><table>
        <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${cols.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');

  const sections = d.sections.map((s, i) => `
  <section class="${i % 2 ? '' : 'alt'}"><div class="wrap narrow">
    ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
    ${s.text.split(/\r?\n\s*\r?\n/).map((p) => `<p class="text">${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('')}
  </div></section>`).join('');

  const contact = [d.contact.phone && `โทร ${esc(d.contact.phone)}`, esc(d.contact.email), esc(d.contact.address)].filter(Boolean);

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.headline || title)}</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:"Segoe UI","Leelawadee UI",Tahoma,sans-serif;color:#0e1b33;background:#fff;line-height:1.6}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}.narrow{max-width:760px}
header{position:sticky;top:0;background:rgba(255,255,255,.94);border-bottom:1px solid #e6eaf0;z-index:5}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.brand{font-weight:700;font-size:17px;letter-spacing:.02em}
nav{display:flex;gap:4px;flex-wrap:wrap}
nav button{border:0;background:none;font:inherit;font-size:14px;color:#4a5568;padding:8px 12px;border-radius:8px;cursor:pointer}
nav button:hover{background:#f2f5fa;color:#0e1b33}
.btn{display:inline-block;border:0;background:#1f62c4;color:#fff;font:inherit;font-weight:600;padding:12px 22px;border-radius:10px;cursor:pointer}
.btn.ghost{background:#fff;color:#1f62c4;box-shadow:inset 0 0 0 1px #c9d8f0}
.hero{background:linear-gradient(160deg,#f4f8fe 0%,#fff 60%);padding:88px 0 72px}
.hero small{color:#1f62c4;letter-spacing:.14em;font-weight:600;font-size:12px}
.hero h1{font-size:44px;line-height:1.2;margin:10px 0 16px;letter-spacing:-.01em;max-width:760px}
.hero p{color:#4a5568;font-size:17px;max-width:640px;margin:0 0 28px}
.hero .row{display:flex;gap:12px;flex-wrap:wrap}
.stats{display:flex;gap:40px;flex-wrap:wrap;margin-top:44px}
.stats b{display:block;font-size:30px;line-height:1.2}.stats span{color:#6b7689;font-size:14px}
section{padding:72px 0}
section h2{font-size:28px;margin:0 0 6px}
section .sub{color:#6b7689;margin:0 0 32px}
.text{color:#4a5568;font-size:16px;margin:14px 0 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card{border:1px solid #e6eaf0;border-radius:14px;padding:24px;background:#fff}
.card .no{color:#1f62c4;font-weight:700;font-size:13px}
.card h3{margin:8px 0 6px;font-size:17px}
.card p{margin:0;color:#6b7689;font-size:14.5px}
.alt{background:#f7f9fc}
.tablebox{border:1px solid #e6eaf0;border-radius:14px;background:#fff;margin-top:18px;overflow:hidden}
.tablebox h3{margin:0;padding:16px 20px;font-size:16px;border-bottom:1px solid #e6eaf0}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th,td{text-align:left;padding:11px 20px;border-bottom:1px solid #eef1f5;white-space:nowrap}
th{color:#6b7689;font-weight:600;font-size:12.5px;background:#fafbfd}
tr:last-child td{border-bottom:0}
form{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:640px}
form label{font-size:13px;color:#4a5568;display:grid;gap:6px}
form .full{grid-column:1/-1}
input,textarea{font:inherit;border:1px solid #d9e0ea;border-radius:10px;padding:10px 12px;width:100%}
textarea{min-height:110px;resize:vertical}
.ok{grid-column:1/-1;background:#e6f5ee;color:#1a7f5a;border-radius:10px;padding:12px 14px}
.info{color:#4a5568;margin:0 0 24px}
footer{border-top:1px solid #e6eaf0;padding:28px 0;color:#8a94a6;font-size:13px}
@media(max-width:760px){.hero{padding:56px 0}.hero h1{font-size:30px}.grid,form{grid-template-columns:1fr}nav{display:none}}
</style>
</head>
<body>
<header><div class="wrap">
  <div class="brand">${brand}</div>
  <nav>
    <button data-to="top">หน้าแรก</button>
    ${has.services ? '<button data-to="features">บริการ</button>' : ''}
    ${has.data ? '<button data-to="data">ข้อมูล</button>' : ''}
    <button data-to="contact">ติดต่อเรา</button>
  </nav>
</div></header>

<main id="top">
  <div class="hero"><div class="wrap">
    <small>${brand}</small>
    <h1>${esc(d.headline)}</h1>
    <p>${esc(d.lead)}</p>
    <div class="row">
      ${d.cta ? `<button class="btn" data-to="contact">${esc(d.cta)}</button>` : ''}
      ${has.services ? '<button class="btn ghost" data-to="features">ดูบริการทั้งหมด</button>' : ''}
    </div>
    ${has.stats ? `<div class="stats">${stats}</div>` : ''}
  </div></div>
${has.services ? `
  <section id="features"><div class="wrap">
    <h2>บริการและความสามารถของระบบ</h2>
    <p class="sub">สิ่งที่ผู้ใช้งานทำได้บนเว็บไซต์นี้</p>
    <div class="grid">${cards}
    </div>
  </div></section>` : ''}
${has.data ? `
  <section id="data" class="alt"><div class="wrap">
    <h2>ข้อมูลในระบบ</h2>
    <p class="sub">ตัวอย่างข้อมูลที่ระบบแสดงให้ผู้ใช้งาน</p>${tables}
  </div></section>` : ''}
${sections}
  <section id="contact"><div class="wrap">
    <h2>ติดต่อเรา</h2>
    ${contact.length ? `<p class="info">${contact.join(' · ')}</p>` : '<p class="sub">กรอกข้อมูลแล้วทีมงานจะติดต่อกลับ</p>'}
    <form id="f">
      <label>ชื่อ<input required placeholder="ชื่อ-นามสกุล"></label>
      <label>เบอร์โทรศัพท์<input required inputmode="numeric" maxlength="10" placeholder="08xxxxxxxx"></label>
      <label class="full">ข้อความ<textarea placeholder="รายละเอียดที่ต้องการสอบถาม"></textarea></label>
      <div class="full"><button class="btn">ส่งข้อความ</button></div>
      <div class="ok" id="ok" hidden>ส่งข้อความเรียบร้อย (ตัวอย่าง — ยังไม่ได้ส่งข้อมูลจริง)</div>
    </form>
  </div></section>
</main>

<footer><div class="wrap">© ${brand} · หน้าเว็บตัวอย่างสำหรับนำเสนอ</div></footer>
<script>
document.querySelectorAll('[data-to]').forEach(function (b) {
  b.addEventListener('click', function () { document.getElementById(b.dataset.to).scrollIntoView({ behavior: 'smooth' }); });
});
document.getElementById('f').addEventListener('submit', function (e) { e.preventDefault(); document.getElementById('ok').hidden = false; });
</script>
</body>
</html>`;
}

// ข้อมูลหน้า Demo ของงานขาย: ที่ทีมพัฒนาบันทึกไว้ หรือค่าตั้งต้นถ้ายังไม่เคยแก้
export function demoDataOf(deal, items) {
  try {
    if (deal.demo_data) return cleanDemoData(JSON.parse(deal.demo_data));
  } catch { /* ข้อมูลเสีย: ใช้ค่าตั้งต้น */ }
  return defaultDemoData(deal, items);
}

export function fallbackDemo(deal, items) {
  return renderDemo(demoDataOf(deal, items), deal.title);
}
