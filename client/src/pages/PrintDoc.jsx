import { useParams } from 'react-router-dom';
import { bahtText, dateLong, DOC_TYPE, money2 } from '../lib.js';
import { Icon, useData } from '../components/ui.jsx';

const CSS = `
.sheet-bar { max-width: 210mm; margin: 20px auto 0; display: flex; justify-content: space-between; align-items: center; }
.sheet { background: #fff; max-width: 210mm; min-height: 297mm; margin: 16px auto 40px; padding: 18mm 16mm; box-shadow: var(--shadow); border: 1px solid var(--line); font-size: 13.5px; color: #0d1b34; }
.sheet h1 { font-size: 26px; font-weight: 600; letter-spacing: 0; }
.sheet .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid var(--navy); padding-bottom: 14px; margin-bottom: 18px; }
.sheet .co b { font-size: 16px; }
.sheet .meta { text-align: right; }
.sheet .meta .no { color: var(--accent); font-weight: 500; }
.sheet .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 18px; }
.sheet .label { font-size: 11px; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 4px; }
.sheet table { margin-bottom: 14px; }
.sheet th { background: #f2f5fa; color: var(--ink-2); border-bottom: 0; padding: 9px 10px; }
.sheet td { padding: 9px 10px; }
.sheet .sum { margin-left: auto; width: 300px; }
.sheet .words { background: #f2f5fa; border-radius: 8px; padding: 8px 12px; margin: 12px 0 18px; }
.sheet .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 56px; text-align: center; }
.sheet .signs div { border-top: 1px solid #9aa5b8; padding-top: 8px; }
.sheet .clause { margin: 12px 0; text-align: justify; }
.sheet .clause b { display: block; margin-bottom: 2px; }
.sheet .wm { color: var(--danger); border: 2px solid var(--danger); display: inline-block; padding: 2px 12px; border-radius: 6px; font-weight: 600; margin-top: 6px; }
@media print {
  @page { size: A4; margin: 0; }
  body { background: #fff; }
  .sheet-bar { display: none; }
  .sheet { margin: 0; border: 0; box-shadow: none; max-width: none; }
}
@media (max-width: 700px) { .sheet { padding: 20px 16px; } .sheet .parties, .sheet .signs { grid-template-columns: 1fr; } .sheet .head { flex-direction: column; } .sheet .meta { text-align: left; } }
`;

export default function PrintDoc() {
  const { id } = useParams();
  const [doc] = useData(`/documents/${id}`);
  if (!doc) return null;
  const d = doc.data;
  const co = d.company;
  const inst = d.installment;
  const isContract = doc.type === 'contract';

  return (
    <>
      <style>{CSS}</style>
      <div className="sheet-bar">
        <span className="muted">{DOC_TYPE[doc.type]} {doc.number}</span>
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" />พิมพ์ / บันทึกเป็น PDF</button>
      </div>
      <div className="sheet">
        <div className="head">
          <div className="co">
            <b>{co.name_th || co.name}</b>
            {co.name_th && co.name && <div>{co.name}</div>}
            <div className="small">{co.address}</div>
            <div className="small">{[co.tax_id && `เลขประจำตัวผู้เสียภาษี ${co.tax_id}`, co.phone && `โทร ${co.phone}`, co.email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="meta">
            <h1>{DOC_TYPE[doc.type]}</h1>
            <div className="no">เลขที่ {doc.number}</div>
            <div>วันที่ {dateLong(doc.issued_at)}</div>
            {doc.type === 'quotation' && <div>ยืนราคาถึง {dateLong(doc.due_at)}</div>}
            {doc.type === 'invoice' && <div>ครบกำหนดชำระ {dateLong(doc.due_at)}</div>}
            {doc.ref_number && <div>อ้างถึงใบแจ้งหนี้ {doc.ref_number}</div>}
            {doc.status === 'void' && <div className="wm">ยกเลิก</div>}
          </div>
        </div>

        {isContract ? <Contract d={d} doc={doc} /> : (
          <>
            <div className="parties">
              <div>
                <div className="label">ลูกค้า</div>
                <b>{d.customer.company || d.customer.name}</b>
                {d.customer.company && <div>ผู้ติดต่อ {d.customer.name}</div>}
                <div className="small">{d.customer.address}</div>
                <div className="small">{[d.customer.tax_id && `เลขประจำตัวผู้เสียภาษี ${d.customer.tax_id}`, d.customer.phone, d.customer.email].filter(Boolean).join(' · ')}</div>
              </div>
              <div>
                <div className="label">โครงการ</div>
                <b>{d.deal.title}</b>
                {d.extra && <div><b>งานเพิ่มเติม #{d.extra.no}: {d.extra.title}</b>{d.extra.contract && ` · ตามสัญญา ${d.extra.contract}`}</div>}
                <div>อ้างอิง {d.deal.code} · ระยะเวลา {d.deal.duration_days} วันทำการ</div>
                {d.sales && <div className="small">ผู้เสนอราคา {d.sales.name} · {d.sales.email}</div>}
              </div>
            </div>

            {doc.type === 'quotation' ? (
              <>
                <ItemsTable d={d} />
                <Totals rows={[['รวมรายการ', d.totals.subtotal], d.totals.discount > 0 && ['ส่วนลด', -d.totals.discount], ['มูลค่าก่อนภาษี', d.totals.net], [`ภาษีมูลค่าเพิ่ม ${d.totals.vat_percent}%`, d.totals.vat]]} total={d.totals.total} />
                <div className="label">เงื่อนไขการชำระเงิน</div>
                <ul className="plain" style={{ marginBottom: 12 }}>{d.payment_terms.map((t, i) => <li key={i}>{t.label} — {t.percent}%</li>)}</ul>
                {d.phase2?.length > 0 && (
                  <>
                    <div className="label">งานเฟส 2 (ไม่รวมในราคานี้ เสนอราคาแยกเมื่อพร้อม)</div>
                    <ul className="plain" style={{ marginBottom: 12 }}>{d.phase2.map((p, i) => <li key={i}>{p.title}</li>)}</ul>
                  </>
                )}
                {d.quote_note && (
                  <>
                    <div className="label">หมายเหตุ / เงื่อนไขเพิ่มเติม</div>
                    <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{d.quote_note}</p>
                  </>
                )}
                <div className="small muted">ราคาไม่รวมค่า Server, Domain และบริการของบุคคลที่สาม เว้นแต่ระบุไว้ในรายการ · ขอบเขตงานนอกเหนือจากรายการข้างต้นจะเสนอราคาเพิ่มเติม</div>
              </>
            ) : (
              <>
                <table>
                  <thead><tr><th>รายการ</th><th className="right">จำนวนเงิน (บาท)</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>
                        ค่าพัฒนาระบบ “{d.deal.title}” — {inst.label}
                        <div className="small muted">งวดที่ {inst.no}/{inst.of} คิดเป็น {inst.percent}% ของมูลค่างาน {money2(d.totals.net)} บาท</div>
                      </td>
                      <td className="right num">{money2(inst.net)}</td>
                    </tr>
                  </tbody>
                </table>
                <Totals rows={[['มูลค่าก่อนภาษี', inst.net], [`ภาษีมูลค่าเพิ่ม ${d.totals.vat_percent}%`, inst.vat]]} total={inst.total} />
                {doc.type === 'receipt' && <p>ได้รับชำระเงินเมื่อวันที่ {dateLong(d.paid_at)} โดย{d.method} เรียบร้อยแล้ว</p>}
              </>
            )}

            <div className="signs">
              <div>{doc.type === 'receipt' ? 'ผู้จ่ายเงิน' : 'ลูกค้า / ผู้อนุมัติ'}<br /><span className="small muted">วันที่ ........./........./.........</span></div>
              <div>{doc.type === 'receipt' ? 'ผู้รับเงิน' : 'ผู้มีอำนาจลงนาม'}{co.signer && ` (${co.signer})`}<br /><span className="small muted">{co.name_th || co.name}</span></div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ItemsTable({ d }) {
  return (
    <table>
      <thead><tr><th style={{ width: 36 }}>#</th><th>รายการ</th><th className="right">จำนวนเงิน (บาท)</th></tr></thead>
      <tbody>
        {d.items.map((it, i) => (
          <tr key={i}>
            <td className="num">{i + 1}</td>
            <td>{it.title}<div className="small muted">{it.description}</div></td>
            <td className="right num">{money2(it.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ rows, total }) {
  return (
    <>
      <dl className="kv sum">
        {rows.filter(Boolean).map(([label, v]) => [<dt key={label}>{label}</dt>, <dd key={label + 'v'}>{money2(v)}</dd>])}
        <dt className="total">รวมทั้งสิ้น</dt><dd className="total">{money2(total)}</dd>
      </dl>
      <div className="words">จำนวนเงินตัวอักษร: <b>{bahtText(total)}</b></div>
    </>
  );
}

function Contract({ d, doc }) {
  const co = d.company;
  const cu = d.customer;
  return (
    <>
      <p className="clause">
        สัญญาฉบับนี้ทำขึ้นเมื่อวันที่ {dateLong(doc.issued_at)} ระหว่าง <b style={{ display: 'inline' }}>{cu.company || cu.name}</b>
        {cu.address && ` ที่อยู่ ${cu.address}`}{cu.tax_id && ` เลขประจำตัวผู้เสียภาษี ${cu.tax_id}`} ซึ่งต่อไปนี้เรียกว่า “ผู้ว่าจ้าง” ฝ่ายหนึ่ง กับ{' '}
        <b style={{ display: 'inline' }}>{co.name_th || co.name}</b>{co.address && ` ที่อยู่ ${co.address}`}{co.tax_id && ` เลขประจำตัวผู้เสียภาษี ${co.tax_id}`} ซึ่งต่อไปนี้เรียกว่า “ผู้รับจ้าง” อีกฝ่ายหนึ่ง
        ทั้งสองฝ่ายตกลงทำสัญญากันดังต่อไปนี้
      </p>
      <div className="clause"><b>ข้อ 1 ขอบเขตงาน</b>ผู้รับจ้างตกลงพัฒนาและส่งมอบระบบ “{d.deal.title}” (อ้างอิง {d.deal.code}) ตามรายการต่อไปนี้</div>
      <ItemsTable d={d} />
      <div className="clause"><b>ข้อ 2 ค่าจ้าง</b>ผู้ว่าจ้างตกลงชำระค่าจ้างเป็นเงิน {money2(d.totals.net)} บาท ภาษีมูลค่าเพิ่ม {d.totals.vat_percent}% เป็นเงิน {money2(d.totals.vat)} บาท รวมเป็นเงินทั้งสิ้น {money2(d.totals.total)} บาท ({bahtText(d.totals.total)})</div>
      <div className="clause"><b>ข้อ 3 การชำระเงิน</b>ผู้ว่าจ้างจะชำระค่าจ้างเป็นงวด ดังนี้
        <ul className="plain">{d.payment_terms.map((t, i) => <li key={i}>{t.label} — {t.percent}% ของค่าจ้าง</li>)}</ul>
      </div>
      <div className="clause"><b>ข้อ 4 ระยะเวลาดำเนินงาน</b>ผู้รับจ้างจะเริ่มงานวันที่ {dateLong(d.start_date)} และส่งมอบงานภายในวันที่ {dateLong(d.end_date)} รวม {d.deal.duration_days} วันทำการ ทั้งนี้ระยะเวลาอาจขยายออกไปเท่ากับระยะเวลาที่ผู้ว่าจ้างส่งมอบข้อมูลหรือตรวจรับงานล่าช้า</div>
      <div className="clause"><b>ข้อ 5 การตรวจรับงาน</b>ผู้ว่าจ้างจะตรวจรับงานภายใน 7 วันทำการนับจากวันที่ได้รับแจ้งส่งมอบ หากพ้นกำหนดโดยไม่มีการแจ้งแก้ไขเป็นลายลักษณ์อักษร ให้ถือว่าผู้ว่าจ้างตรวจรับงานแล้ว</div>
      <div className="clause"><b>ข้อ 6 การเปลี่ยนแปลงขอบเขตงาน</b>งานนอกเหนือจากข้อ 1 ทั้งสองฝ่ายจะตกลงค่าจ้างและระยะเวลาเพิ่มเติมเป็นลายลักษณ์อักษรก่อนเริ่มดำเนินการ</div>
      <div className="clause"><b>ข้อ 7 ทรัพย์สินทางปัญญาและการรักษาความลับ</b>เมื่อผู้ว่าจ้างชำระค่าจ้างครบถ้วน สิทธิ์ในผลงานที่พัฒนาขึ้นเฉพาะตามสัญญานี้ตกเป็นของผู้ว่าจ้าง ทั้งสองฝ่ายจะไม่เปิดเผยข้อมูลความลับของอีกฝ่ายต่อบุคคลภายนอก</div>
      <div className="clause"><b>ข้อ 8 การรับประกัน</b>ผู้รับจ้างรับประกันแก้ไขข้อบกพร่องของระบบที่เกิดจากการพัฒนาโดยไม่คิดค่าใช้จ่ายเป็นเวลา 90 วันนับจากวันตรวจรับงาน</div>
      <p className="clause">สัญญานี้ทำขึ้นสองฉบับมีข้อความตรงกัน ทั้งสองฝ่ายได้อ่านและเข้าใจโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐาน</p>
      <div className="signs">
        <div>ผู้ว่าจ้าง<br /><span className="small muted">{cu.company || cu.name}</span></div>
        <div>ผู้รับจ้าง{co.signer && ` (${co.signer})`}<br /><span className="small muted">{co.name_th || co.name}</span></div>
      </div>
    </>
  );
}
