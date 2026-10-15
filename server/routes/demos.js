// หน้า Demo สำหรับทีมพัฒนา: เพิ่ม/แก้ข้อมูลที่แสดงบนหน้า Demo ของแต่ละงานขาย
// ผู้ใช้กลุ่มนี้เห็นเฉพาะข้อมูลที่ต้องใช้ทำ Demo (ไม่เห็นราคาและเอกสาร)
import { Router } from 'express';
import { q, notify, getSettings } from '../db.js';
import { canEditDemo } from '../auth.js';
import { parseChecks, requirementOptions } from '../estimator.js';
import { cleanDemoData, demoDataOf, renderDemo } from '../demo-template.js';
import { cleanHttpUrl } from '../url.js';
import { dealTotals, feasibility, priceItem } from '../estimator.js';
import { notifyDealTeam } from './teamwork.js';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

const router = Router();

router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  if (!canEditDemo(req.user)) return res.status(403).json({ error: 'เฉพาะทีมพัฒนาและผู้ดูแลระบบที่แก้ไขหน้า Demo ได้' });
  next();
});

const itemsOf = (dealId) => q.all('SELECT title, description FROM deal_items WHERE deal_id = ? ORDER BY sort, id', dealId);

// dev เข้าถึงได้เฉพาะงานที่ผู้ถือหุ้นกดเลือกส่งให้ตนเอง (admin เข้าได้ทุกงาน)
function findDeal(req, res) {
  const deal = q.get('SELECT * FROM deals WHERE id = ?', req.params.id);
  if (!deal) return res.status(404).json({ error: 'ไม่พบงานขายนี้' }) && null;
  if (req.user.role !== 'admin' && deal.dev_id !== req.user.id) {
    return res.status(403).json({ error: 'งานนี้ยังไม่ได้ส่งให้คุณ — ต้องรอผู้ถือหุ้นเลือกคุณเป็น dev ของงานนี้ก่อน' }) && null;
  }
  return deal;
}

// ความเป็นไปได้ของงาน (ไม่ส่งราคาให้ dev)
function feasibilityOf(deal) {
  const settings = getSettings();
  const items = q.all('SELECT * FROM deal_items WHERE deal_id = ?', deal.id).map((i) => priceItem(i, settings));
  if (!items.length) return null;
  return feasibility(deal, dealTotals(items, deal, settings), settings);
}

// dev ต้องกดรับงานก่อนจึงประเมิน/ส่งลิงก์ได้ (admin ทำแทนได้)
function needAccepted(req, res, deal) {
  if (req.user.role === 'admin' || deal.dev_accepted_at) return true;
  res.status(409).json({ error: 'กรุณากดรับงานก่อน' });
  return false;
}

// dev กดรับงานที่ผู้ถือหุ้นส่งให้
router.post('/:id/accept', (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (deal.dev_id !== req.user.id) return res.status(403).json({ error: 'เฉพาะ dev ที่ได้รับเลือกเท่านั้นที่กดรับงานได้' });
  if (!deal.dev_accepted_at) {
    q.run("UPDATE deals SET dev_accepted_at = datetime('now') WHERE id = ?", deal.id);
    notifyDealTeam(deal, req.user.id, { title: `${req.user.name} กดรับงาน ${deal.code} แล้ว`, body: `${deal.title} — คุยงานกับ dev ได้ที่แท็บ “คุยงานกับ dev”`, link: `/deals/${deal.id}?tab=team` });
  }
  res.json({ ok: true });
});

// dev ปรับคะแนนความเป็นไปได้ทางเทคนิคหลังดู Requirement พร้อมเหตุผล
router.put('/:id/feasibility', (req, res) => {
  const deal = findDeal(req, res);
  if (!deal || !needAccepted(req, res, deal)) return;
  if (!deal.analysis) return res.status(409).json({ error: 'งานนี้ยังไม่ได้วิเคราะห์ Requirement' });
  const score = Number(req.body?.technical_score);
  if (req.body?.technical_score === '' || !Number.isFinite(score)) return res.status(400).json({ error: 'กรุณาใส่คะแนน 0–100' });
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const analysis = JSON.parse(deal.analysis);
  const review = { score: clamp(score), before: analysis.dev_review?.before ?? analysis.technical_score, note, by: req.user.name, at: new Date().toISOString() };
  q.run('UPDATE deals SET analysis = ? WHERE id = ?', JSON.stringify({ ...analysis, technical_score: review.score, dev_review: review }), deal.id);
  notifyDealTeam(deal, req.user.id, { title: `dev ปรับประเมินความเป็นไปได้ ${deal.code}`, body: `ความเป็นไปได้ทางเทคนิค ${review.score}/100${note ? ' — ' + note.slice(0, 120) : ''}`, link: `/deals/${deal.id}?tab=estimate` });
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const mine = req.user.role === 'admin' ? '' : 'AND d.dev_id = ?';
  res.json(q.all(
    `SELECT d.id, d.code, d.title, d.status, d.customer_name, d.customer_company, d.demo_source, d.demo_url,
            d.demo_html IS NOT NULL AS has_demo, u.name AS sales_name, d.dev_id, dv.name AS dev_name, d.dev_accepted_at
     FROM deals d LEFT JOIN users u ON u.id = d.sales_id LEFT JOIN users dv ON dv.id = d.dev_id WHERE d.status != 'lost' ${mine} ORDER BY d.id DESC`,
    ...(mine ? [req.user.id] : []),
  ));
});

router.get('/:id', (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const items = itemsOf(deal.id);
  const checks = parseChecks(deal);
  res.json({
    id: deal.id, code: deal.code, title: deal.title, status: deal.status,
    customer: deal.customer_company || deal.customer_name,
    sales_name: q.get('SELECT name FROM users WHERE id = ?', deal.sales_id)?.name ?? null,
    dev_id: deal.dev_id,
    dev_name: deal.dev_id ? q.get('SELECT name FROM users WHERE id = ?', deal.dev_id)?.name ?? null : null,
    can_chat: req.user.role === 'admin' || deal.dev_id === req.user.id || deal.sales_id === req.user.id,
    dev_accepted_at: deal.dev_accepted_at,
    is_dev: deal.dev_id === req.user.id,
    feasibility: feasibilityOf(deal),
    dev_review: deal.analysis ? JSON.parse(deal.analysis).dev_review ?? null : null,
    requirement: deal.requirement,
    checklist: requirementOptions().filter((o) => checks.includes(o.id)).map((o) => o.title),
    items,
    demo_html: deal.demo_html, demo_source: deal.demo_source, demo_url: deal.demo_url,
    data: demoDataOf(deal, items),
  });
});

// ดูตัวอย่างจากข้อมูลที่กำลังแก้ โดยยังไม่บันทึก
router.post('/:id/preview', (req, res) => {
  const deal = findDeal(req, res);
  if (deal) res.json({ html: renderDemo(req.body?.data, deal.title) });
});

// บันทึกหน้า Demo: mode 'data' = สร้างหน้าจากข้อมูล · mode 'html' = ใช้ HTML ที่แก้เอง
router.put('/:id', (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  const b = req.body || {};

  if (b.mode === 'html') {
    const html = String(b.html || '');
    if (!/<html[\s>]/i.test(html)) return res.status(400).json({ error: 'ต้องเป็นหน้า HTML ทั้งหน้า (มีแท็ก <html>)' });
    if (html.length > 600_000) return res.status(400).json({ error: 'ไฟล์ HTML ใหญ่เกิน 600KB' });
    q.run("UPDATE deals SET demo_html = ?, demo_source = 'html' WHERE id = ?", html, deal.id);
  } else {
    const data = cleanDemoData(b.data);
    if (!data.headline) return res.status(400).json({ error: 'กรุณากรอกหัวข้อหลักของหน้า Demo' });
    q.run(
      "UPDATE deals SET demo_data = ?, demo_html = ?, demo_source = 'dev' WHERE id = ?",
      JSON.stringify(data), renderDemo(data, deal.title), deal.id,
    );
  }

  // แจ้งทุก role ที่เข้าถึงงานนี้ได้: พนักงานขายเจ้าของงาน, dev ที่รับงาน, admin, ผู้ถือหุ้น และกรรมการ (ยกเว้นคนที่แก้เอง)
  const recipients = q.all(
    "SELECT id, role FROM users WHERE active = 1 AND id != ? AND (id IN (?, ?) OR role IN ('admin', 'shareholder', 'director'))",
    req.user.id, deal.sales_id ?? 0, deal.dev_id ?? 0,
  );
  for (const u of recipients) {
    notify({
      user_id: u.id, title: `หน้า Demo ของ ${deal.code} อัปเดตแล้ว`, body: `${deal.title} — แก้ไขโดย ${req.user.name}`,
      link: u.role === 'staff' ? `/demos/${deal.id}` : `/deals/${deal.id}`,
    });
  }
  res.json({ ok: true });
});

// dev แนบลิงก์หน้าเว็บ Demo ให้พนักงานขายดูก่อนนำไปขาย (ส่งค่าว่างเพื่อลบลิงก์)
router.put('/:id/link', (req, res) => {
  const deal = findDeal(req, res);
  if (!deal) return;
  if (!needAccepted(req, res, deal)) return;
  const { url, error } = cleanHttpUrl(req.body?.url);
  if (error) return res.status(400).json({ error });
  q.run('UPDATE deals SET demo_url = ? WHERE id = ?', url, deal.id);
  if (url && url !== deal.demo_url) {
    // ส่งลิงก์เข้าห้องคุยงานด้วย ให้พนักงานขายเห็นในแชต
    q.run('INSERT INTO deal_messages (deal_id, user_id, body) VALUES (?, ?, ?)', deal.id, req.user.id, `ส่งลิงก์ Demo: ${url}`);
    notifyDealTeam(deal, req.user.id, { title: `มีลิงก์ Demo สำหรับ ${deal.code}`, body: `${deal.title} — ${req.user.name} ส่งลิงก์ให้ดูก่อนนำไปเสนอลูกค้า`, link: `/deals/${deal.id}?tab=demo` });
  }
  res.json({ ok: true, demo_url: url });
});

export default router;
