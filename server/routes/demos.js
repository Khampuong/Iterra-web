// หน้า Demo สำหรับทีมพัฒนา: เพิ่ม/แก้ข้อมูลที่แสดงบนหน้า Demo ของแต่ละงานขาย
// ผู้ใช้กลุ่มนี้เห็นเฉพาะข้อมูลที่ต้องใช้ทำ Demo (ไม่เห็นราคาและเอกสาร)
import { Router } from 'express';
import { q, notify } from '../db.js';
import { canEditDemo } from '../auth.js';
import { parseChecks, requirementOptions } from '../estimator.js';
import { cleanDemoData, demoDataOf, renderDemo } from '../demo-template.js';
import { cleanHttpUrl } from '../url.js';

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

router.get('/', (req, res) => {
  const mine = req.user.role === 'admin' ? '' : 'AND d.dev_id = ?';
  res.json(q.all(
    `SELECT d.id, d.code, d.title, d.status, d.customer_name, d.customer_company, d.demo_source, d.demo_url,
            d.demo_html IS NOT NULL AS has_demo, u.name AS sales_name, d.dev_id, dv.name AS dev_name
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
  const { url, error } = cleanHttpUrl(req.body?.url);
  if (error) return res.status(400).json({ error });
  q.run('UPDATE deals SET demo_url = ? WHERE id = ?', url, deal.id);
  if (url && url !== deal.demo_url && deal.sales_id && deal.sales_id !== req.user.id) {
    notify({ user_id: deal.sales_id, title: `มีลิงก์ Demo สำหรับ ${deal.code}`, body: `${deal.title} — ${req.user.name} แนบลิงก์ให้ดูก่อนนำไปขาย`, link: `/deals/${deal.id}` });
  }
  res.json({ ok: true, demo_url: url });
});

export default router;
