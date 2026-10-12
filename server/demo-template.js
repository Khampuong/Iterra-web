// หน้าเว็บ Demo เบื้องต้นแบบสำเร็จรูป ใช้เมื่อเรียก Claude API ไม่ได้
// สร้างเป็นหน้าเว็บหน้าเดียว: เมนู, ส่วนนำ, บริการ/ฟีเจอร์จากรายการงาน, ขั้นตอน, ติดต่อ

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// รายการที่เป็นงานภายในหรือบริการเสริม ไม่นำไปแสดงเป็นบริการบนหน้าเว็บของลูกค้า
const INTERNAL = /Requirement|วิเคราะห์และออกแบบ|ทดสอบระบบ|นำขึ้นใช้งาน|ขึ้น Server|จด Domain|Service ดูแลระบบ/;

export function fallbackDemo(deal, items) {
  const features = items.filter((i) => !INTERNAL.test(i.title));
  const list = (features.length ? features : items).slice(0, 9);
  const brand = esc(deal.customer_company || deal.customer_name);
  const lead = esc((deal.requirement || '').trim().split(/\r?\n/)[0].slice(0, 180));

  const cards = list.map((f, i) => `
      <article class="card">
        <span class="no">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.description || '')}</p>
      </article>`).join('');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deal.title)}</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:"Segoe UI","Leelawadee UI",Tahoma,sans-serif;color:#0e1b33;background:#fff;line-height:1.6}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
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
section{padding:72px 0}
section h2{font-size:28px;margin:0 0 6px}
section .sub{color:#6b7689;margin:0 0 32px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card{border:1px solid #e6eaf0;border-radius:14px;padding:24px;background:#fff}
.card .no{color:#1f62c4;font-weight:700;font-size:13px}
.card h3{margin:8px 0 6px;font-size:17px}
.card p{margin:0;color:#6b7689;font-size:14.5px}
.alt{background:#f7f9fc}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;counter-reset:s}
.steps div{counter-increment:s;padding-top:14px;border-top:2px solid #1f62c4}
.steps div::before{content:"ขั้นที่ " counter(s);color:#1f62c4;font-size:13px;font-weight:600}
.steps h3{margin:4px 0;font-size:17px}.steps p{margin:0;color:#6b7689;font-size:14.5px}
form{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:640px}
form label{font-size:13px;color:#4a5568;display:grid;gap:6px}
form .full{grid-column:1/-1}
input,textarea{font:inherit;border:1px solid #d9e0ea;border-radius:10px;padding:10px 12px;width:100%}
textarea{min-height:110px;resize:vertical}
.ok{grid-column:1/-1;background:#e6f5ee;color:#1a7f5a;border-radius:10px;padding:12px 14px}
footer{border-top:1px solid #e6eaf0;padding:28px 0;color:#8a94a6;font-size:13px}
@media(max-width:760px){.hero{padding:56px 0}.hero h1{font-size:30px}.grid,.steps,form{grid-template-columns:1fr}nav{display:none}}
</style>
</head>
<body>
<header><div class="wrap">
  <div class="brand">${brand}</div>
  <nav>
    <button data-to="top">หน้าแรก</button>
    <button data-to="features">บริการ</button>
    <button data-to="how">ขั้นตอน</button>
    <button data-to="contact">ติดต่อเรา</button>
  </nav>
</div></header>

<main id="top">
  <div class="hero"><div class="wrap">
    <small>${brand}</small>
    <h1>${esc(deal.title)}</h1>
    <p>${lead || 'บริการครบในที่เดียว ใช้งานง่าย สะดวกทั้งบนคอมพิวเตอร์และมือถือ'}</p>
    <div class="row">
      <button class="btn" data-to="contact">เริ่มใช้งาน</button>
      <button class="btn ghost" data-to="features">ดูบริการทั้งหมด</button>
    </div>
  </div></div>

  <section id="features"><div class="wrap">
    <h2>บริการและความสามารถของระบบ</h2>
    <p class="sub">สิ่งที่ผู้ใช้งานทำได้บนเว็บไซต์นี้</p>
    <div class="grid">${cards}
    </div>
  </div></section>

  <section id="how" class="alt"><div class="wrap">
    <h2>ใช้งานง่ายใน 3 ขั้นตอน</h2>
    <p class="sub">ออกแบบให้ผู้ใช้เริ่มต้นได้ทันที</p>
    <div class="steps">
      <div><h3>ลงทะเบียน</h3><p>กรอกข้อมูลเบื้องต้นเพื่อเริ่มใช้งาน</p></div>
      <div><h3>เลือกบริการ</h3><p>เลือกรายการที่ต้องการและกรอกรายละเอียด</p></div>
      <div><h3>ติดตามผล</h3><p>ตรวจสอบสถานะและรับการแจ้งเตือนได้ตลอด</p></div>
    </div>
  </div></section>

  <section id="contact"><div class="wrap">
    <h2>ติดต่อเรา</h2>
    <p class="sub">กรอกข้อมูลแล้วทีมงานจะติดต่อกลับ</p>
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
