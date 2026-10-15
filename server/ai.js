// เรียก Claude API เพื่อวิเคราะห์ Requirement และสร้างหน้า Demo
// ถ้าเรียกไม่ได้ (ไม่มี credential / เครือข่ายล่ม) ผู้เรียกจะสลับไปใช้ตัวสำรองใน estimator.js
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { POSITIONS, POSITION_CODES } from './positions.js';
import { parseChecks, requirementOptions } from './estimator.js';
import { demoDataOf } from './demo-template.js';

// รายการที่ลูกค้าติ๊กในเช็คลิสต์ เป็นข้อความสำหรับใส่ใน prompt
function checklistText(deal) {
  const checks = parseChecks(deal);
  const picked = requirementOptions().filter((o) => checks.includes(o.id));
  return picked.length ? picked.map((o) => `- ${o.title}: ${o.desc}`).join('\n') : '(ไม่ได้เลือก)';
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
// ถ้า Claude ปฏิเสธคำขอ ให้ API ลองรุ่นสำรองที่ Anthropic แนะนำให้อัตโนมัติ
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

let client;
function getClient() {
  if (process.env.AI_DISABLED === '1') throw new AiUnavailable('ปิดการใช้ AI ไว้ (AI_DISABLED=1)');
  client ??= new Anthropic();
  return client;
}

export class AiUnavailable extends Error {}

function explain(err) {
  if (err instanceof AiUnavailable) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiUnavailable('API key ไม่ถูกต้องหรือหมดอายุ');
  if (err instanceof Anthropic.PermissionDeniedError) return new AiUnavailable('API key ไม่มีสิทธิ์ใช้โมเดลนี้');
  if (err instanceof Anthropic.RateLimitError) return new AiUnavailable('เรียก Claude API ถี่เกินโควตา ลองใหม่อีกครั้งภายหลัง');
  if (err instanceof Anthropic.APIConnectionError) return new AiUnavailable('เชื่อมต่อ Claude API ไม่ได้');
  if (err instanceof Anthropic.APIError) return new AiUnavailable(`Claude API ตอบกลับผิดพลาด (${err.status ?? '-'})`);
  // SDK โยน Error ธรรมดาเมื่อหา credential ไม่เจอ
  if (err instanceof Anthropic.AnthropicError || /authentication method/i.test(err?.message ?? '')) {
    return new AiUnavailable('ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY');
  }
  return err;
}

const AnalysisSchema = z.object({
  summary: z.string().describe('สรุปสิ่งที่ลูกค้าต้องการ 2-3 ประโยค'),
  technical_score: z.number().describe('ความเป็นไปได้ทางเทคนิค 0-100'),
  duration_days: z.number().describe('ระยะเวลาทำงานรวมเป็นวันทำการ'),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
  questions: z.array(z.string()).describe('คำถามที่ควรถามลูกค้าเพิ่มก่อนยืนยันราคา'),
  items: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      priority: z.enum(['must', 'should', 'could']).describe('must = ขาดไม่ได้, should = สำคัญ, could = เลื่อนไปเฟส 2 ได้ถ้าเกินงบ'),
      effort: z.array(z.object({ position: z.enum(POSITION_CODES), days: z.number() })),
    }),
  ),
});

const ANALYST_SYSTEM = `คุณเป็น Solution Architect ของบริษัทรับพัฒนาเว็บและระบบในประเทศไทย หน้าที่คือแตก Requirement ของลูกค้าเป็นรายการงานสำหรับทำใบเสนอราคา

ตำแหน่งงานในทีม (ใช้รหัสเหล่านี้เท่านั้น):
${POSITIONS.map((p) => `- ${p.code}: ${p.name} (${p.th})`).join('\n')}

แนวทาง:
- แตกงานเป็นรายการที่ลูกค้าเข้าใจและตรวจรับได้ (ฟีเจอร์/โมดูล) รวมงานเก็บ Requirement ออกแบบ ทดสอบ และนำขึ้นใช้งานเป็นรายการของตัวเอง
- ประเมิน man-day ต่อตำแหน่งตามจริงสำหรับทีมขนาดเล็กที่มีประสบการณ์ ใส่เฉพาะตำแหน่งที่จำเป็นต่อรายการนั้น ทศนิยมได้ทีละ 0.5
- ไม่ต้องประเมินราคา ระบบจะคำนวณราคาจากอัตราค่าแรงเอง
- technical_score สะท้อนความชัดเจนของ Requirement และความยากทางเทคนิค ไม่เกี่ยวกับงบหรือกำหนดเวลา
- duration_days คือวันทำการตั้งแต่เริ่มจนส่งมอบ โดยคิดว่างานหลายตำแหน่งทำขนานกันได้
- ระบุ priority ทุกรายการ: งานพื้นฐาน (เก็บ Requirement ออกแบบ ทดสอบ นำขึ้นใช้งาน) และฟีเจอร์หลักที่ขาดไม่ได้ = must, ฟีเจอร์ที่ลูกค้าขอ = should, ส่วนเสริมที่เลื่อนไปเฟส 2 ได้ = could
- ถ้าลูกค้าแจ้งงบประมาณ ให้ออกแบบขอบเขตเฟสแรกแบบกระชับ (MVP) ที่เหมาะกับงบ ระบบจะเลื่อนรายการ could/should ไปเฟส 2 และลดกำลังคนให้ราคาพอดีงบเอง
- ถ้า Requirement กำกวม ให้ตั้งสมมติฐานที่สมเหตุสมผลแล้วระบุไว้ใน assumptions และ questions
- ตอบเป็นภาษาไทยทั้งหมด`;

export async function analyzeRequirement(deal) {
  try {
    const res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      system: ANALYST_SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(AnalysisSchema) },
      messages: [
        {
          role: 'user',
          content: `ชื่องาน: ${deal.title}
ประเภทงาน: ${deal.project_type || '-'}
ลูกค้า: ${deal.customer_company || deal.customer_name}
งบประมาณที่ลูกค้าแจ้ง: ${deal.budget ? `${deal.budget} บาท (ก่อน VAT)` : 'ไม่ระบุ'}
วันที่ต้องการใช้งาน: ${deal.deadline || 'ไม่ระบุ'}

สิ่งที่ลูกค้าเลือกจากเช็คลิสต์ (ต้องมีในรายการงาน):
${checklistText(deal)}

ข้อมูลเพิ่มเติมจากลูกค้า:
${deal.requirement || '(ไม่มี)'}`,
        },
      ],
    });
    if (res.stop_reason === 'refusal') throw new AiUnavailable('Claude ปฏิเสธการวิเคราะห์ Requirement นี้');
    if (!res.parsed_output) throw new AiUnavailable('Claude ตอบกลับไม่ครบ (ผลลัพธ์ถูกตัด)');
    const out = res.parsed_output;
    return {
      ...out,
      source: 'claude',
      model: res.model,
      items: out.items.map((it) => ({
        ...it,
        effort: Object.fromEntries(it.effort.map((e) => [e.position, e.days])),
      })),
    };
  } catch (err) {
    throw explain(err);
  }
}

const DEMO_SYSTEM = `คุณเป็น Web Designer ที่สร้างหน้าเว็บตัวอย่างเบื้องต้นให้ฝ่ายขายใช้นำเสนอลูกค้าก่อนตัดสินใจจ้างงาน

สร้างไฟล์ HTML ไฟล์เดียวที่เปิดได้ทันที:
- CSS และ JavaScript อยู่ในไฟล์ทั้งหมด ห้ามโหลดไฟล์ ฟอนต์ รูป หรือสคริปต์จากภายนอก และห้ามเรียกเครือข่าย (หน้านี้แสดงใน iframe ที่ปิดกั้นไว้)
- เป็นหน้าเว็บไซต์ที่ผู้ใช้ทั่วไปของลูกค้าจะเห็น ไม่ใช่หน้าจอหลังบ้านหรือ Dashboard ของผู้ดูแล: มีแถบเมนูด้านบน ส่วนนำ (hero) พร้อมปุ่มหลัก ส่วนแนะนำบริการหรือฟีเจอร์ตามรายการงาน เนื้อหาตัวอย่างที่สมจริงกับธุรกิจของลูกค้า ส่วนติดต่อ และส่วนท้าย
- เป็นหน้าเบื้องต้นให้เห็นภาพรวมและโทนของเว็บ เมนูเลื่อนไปยังแต่ละส่วนได้ ฟอร์มกดส่งแล้วแสดงผลในหน้าได้ ไม่ต้องทำระบบย่อยให้ครบทุกหน้า
- ไม่ต้องแสดงงานภายใน (เช่น เก็บ Requirement ทดสอบ นำขึ้นระบบ)
- ใช้รูปทรงและสีแทนรูปภาพ ไม่ใส่รูปจากภายนอก
- ดีไซน์มินิมอล เรียบหรู โทนฟ้า ขาว เทา ใช้ system font ที่อ่านภาษาไทยได้ รองรับจอมือถือ
- ข้อความในหน้าจอเป็นภาษาไทย

ตอบเฉพาะโค้ด HTML เริ่มที่ <!doctype html> ไม่ต้องมีคำอธิบายหรือ code fence`;

export async function generateDemo(deal, items) {
  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      system: DEMO_SYSTEM,
      output_config: { effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: `ระบบ: ${deal.title}
ลูกค้า: ${deal.customer_company || deal.customer_name}

สิ่งที่ลูกค้าเลือกจากเช็คลิสต์:
${checklistText(deal)}

ข้อมูลเพิ่มเติมจากลูกค้า:
${deal.requirement || '(ไม่มี)'}

${deal.demo_data ? `ข้อมูลที่ทีมพัฒนากำหนดให้แสดงบนหน้าเว็บ (ใช้เนื้อหานี้เป็นหลัก):\n${JSON.stringify(demoDataOf(deal, items), null, 1)}\n` : ''}
รายการงานในใบเสนอราคา:
${items.map((i, n) => `${n + 1}. ${i.title} — ${i.description || ''}`).join('\n')}`,
        },
      ],
    });
    const res = await stream.finalMessage();
    if (res.stop_reason === 'refusal') throw new AiUnavailable('Claude ปฏิเสธการสร้าง Demo สำหรับ Requirement นี้');
    let html = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!/<html[\s>]/i.test(html)) throw new AiUnavailable('Claude ไม่ได้ส่งหน้า HTML กลับมา');
    if (res.stop_reason === 'max_tokens') throw new AiUnavailable('หน้า Demo ยาวเกินกำหนดและถูกตัดกลางทาง');
    return { html, source: 'claude' };
  } catch (err) {
    throw explain(err);
  }
}
