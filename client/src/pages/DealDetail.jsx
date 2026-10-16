import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, date, DEAL_STATUS, DOC_TYPE, money, money2, num, phoneDigits, PROJECTS, SELL, todayStr } from '../lib.js';
import { Avatar, Badge, Bar, Field, Icon, Modal, RequirementChecklist, Tabs, useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import DealChat from '../components/DealChat.jsx';
import DealExtras from '../components/DealExtras.jsx';

const FEAS_COLOR = { go: 'var(--ok)', conditional: '#d39a1c', 'no-go': 'var(--danger)' };
const tone = (score) => (score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'danger');

export default function DealDetail() {
  const { id } = useParams();
  const { user, run, meta } = useApp();
  const nav = useNavigate();
  const [deal, reload, setDeal] = useData(`/deals/${id}`);
  // เปิดแท็บตามลิงก์จากการแจ้งเตือน เช่น /deals/5?tab=team
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'requirement');
  useEffect(() => { if (params.get('tab')) setTab(params.get('tab')); }, [params]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [close, setClose] = useState(null); // ฟอร์มปิดงาน { result, start_date, note }
  if (!deal) return null;

  const isAdmin = user.role === 'admin';
  const canSell = SELL.includes(user.role); // กรรมการดูได้อย่างเดียว
  // ปรับรายการและราคาเพื่อต่อรองกับลูกค้า: admin ผู้ถือหุ้น และพนักงานขายเจ้าของงาน
  const canPrice = isAdmin || user.role === 'shareholder' || (canSell && deal.sales_id === user.id);
  const closed = deal.status === 'won' || deal.status === 'lost';
  // บันทึกงบประมาณ/ข้อมูลลูกค้า แล้ววิเคราะห์ Requirement: พนักงานขาย และผู้ถือหุ้น
  const canReq = canSell || user.role === 'shareholder';
  const steps = meta.sales_steps;
  const stepIndex = steps.findIndex((s) => s.id === deal.step);

  // admin ลบงานขายที่ยังไม่ปิดการขาย พร้อมรายการงาน เอกสาร และข้อความคุยงาน
  const removeDeal = async () => {
    const docs = deal.documents.length ? ` และเอกสาร ${deal.documents.length} ฉบับ` : '';
    if (!window.confirm(`ลบงานขาย ${deal.code} “${deal.title}”${docs}?\nลบแล้วกู้คืนไม่ได้`)) return;
    if (await run(() => api.del(`/deals/${id}`), `ลบงานขาย ${deal.code} แล้ว`)) nav('/deals');
  };

  // เรียก action ที่คืน deal ทั้งก้อนกลับมา
  const act = async (name, fn, ok) => {
    setBusy(name);
    setNotice('');
    const out = await run(fn, ok);
    setBusy('');
    if (out && out.id) {
      setDeal(out);
      if (out.notice) setNotice(out.notice);
    }
    return out;
  };

  const analyze = async () => {
    if (deal.items.length && !window.confirm('วิเคราะห์ใหม่จะแทนที่รายการงานและราคาที่มีอยู่ ต้องการทำต่อหรือไม่')) return;
    if (await act('analyze', () => api.post(`/deals/${id}/analyze`), 'วิเคราะห์ Requirement แล้ว')) setTab('estimate');
  };

  // บันทึกงบประมาณลูกค้า แล้ววิเคราะห์ Requirement ใหม่ตามงบ
  const analyzeBudget = async (budget) => {
    if (deal.items.length && !window.confirm('บันทึกงบและวิเคราะห์ใหม่ตามงบ — รายการงาน ราคา และส่วนลดเดิมจะถูกแทนที่ ต้องการทำต่อหรือไม่')) return;
    await act('analyze', async () => {
      await api.put(`/deals/${id}`, { budget: budget === '' ? null : Number(budget) });
      return api.post(`/deals/${id}/analyze`);
    }, budget === '' ? 'ล้างงบและวิเคราะห์ใหม่แล้ว' : 'บันทึกงบและวิเคราะห์ตามงบประมาณแล้ว');
  };

  // หน้า Requirement: บันทึกข้อมูลลูกค้า/งบประมาณ แล้ววิเคราะห์ Requirement ตามงบทันที
  const saveAndAnalyze = async (form) => {
    if (deal.items.length && !window.confirm('บันทึกและวิเคราะห์ใหม่ตามงบประมาณ — รายการงาน ราคา และส่วนลดเดิมจะถูกแทนที่ ต้องการทำต่อหรือไม่')) return;
    const out = await act('analyze', async () => {
      await api.put(`/deals/${id}`, form);
      return api.post(`/deals/${id}/analyze`);
    }, Number(form.budget) > 0 ? 'บันทึกแล้ว — วิเคราะห์และปรับขอบเขตตามงบประมาณลูกค้าแล้ว' : 'บันทึกและวิเคราะห์ Requirement แล้ว');
    if (out) setTab('estimate');
  };

  return (
    <>
      <PageHead eyebrow={<Link to="/deals">← งานขาย</Link>} title={deal.title} sub={`${deal.code} · ${deal.customer_company || deal.customer_name} · ผู้ขาย ${deal.sales_name ?? '—'} · dev ${deal.dev_name ?? 'ยังไม่ได้เลือก'}`}>
        <Badge tone={DEAL_STATUS[deal.status].tone}>{DEAL_STATUS[deal.status].label}</Badge>
        {isAdmin && deal.status !== 'won' && <button className="btn ghost danger" onClick={removeDeal}><Icon name="trash" />ลบงานขาย</button>}
        {canSell && !closed && (
          <>
            <button className="btn" onClick={() => setTab('requirement')}>อัปเดตข้อมูล</button>
            <button className="btn primary" disabled={!deal.items.length} title={deal.items.length ? '' : 'วิเคราะห์ Requirement ให้มีรายการงานและราคาก่อน'}
              onClick={() => { setTab('docs'); setClose({ result: 'won', start_date: todayStr(), note: '' }); }}>
              <Icon name="check" />ปิดการขาย
            </button>
          </>
        )}
      </PageHead>

      {deal.status !== 'lost' && (
        <div className="steps" style={{ marginBottom: 22 }}>
          {steps.map((s, i) => {
            const done = i < stepIndex || deal.status === 'won';
            // กดที่ขั้นตอนเพื่อย้ายงานไปขั้นนั้นได้ ยกเว้นขั้นปิดการขายซึ่งต้องใช้ปุ่มปิดการขาย
            const movable = canSell && !closed && s.id !== 'won' && i !== stepIndex;
            return (
              <div key={s.id} className="step-wrap">
                <button className={`step ${done ? 'done' : i === stepIndex ? 'now' : ''}`} disabled={!movable || Boolean(busy)}
                  title={movable ? `ย้ายงานไปขั้น “${s.label}”` : undefined}
                  onClick={() => act('step', () => api.put(`/deals/${id}/step`, { step: s.id }), `ย้ายไปขั้น “${s.label}” แล้ว`)}>
                  <b>{done ? <span style={{ width: 12, display: 'grid' }}><Icon name="check" /></span> : i + 1}</b>
                  {s.label}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {notice && <div className="notice" style={{ marginBottom: 18 }}>{notice}</div>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[['requirement', 'Requirement'], ['estimate', 'ประเมินราคาและความเป็นไปได้'], ['team', 'คุยงานกับ dev'], ['demo', 'ลิงก์ Demo'], ['docs', 'เอกสารและปิดงาน']]}
      />

      {tab === 'requirement' && (
        <RequirementTab deal={deal} canEdit={canReq && (!closed || isAdmin)} busy={busy} onAnalyze={analyze} canAnalyze={canReq && !closed} onSaveAnalyze={saveAndAnalyze}
          onSave={(form) => act('save', () => api.put(`/deals/${id}`, form), 'บันทึกแล้ว')} />
      )}
      {tab === 'estimate' && (
        <EstimateTab deal={deal} canPrice={canPrice} limited={canPrice && !['admin', 'shareholder'].includes(user.role)} canSell={canSell} busy={busy} onAnalyze={analyze}
          canAnalyze={canReq && !closed} onBudgetAnalyze={analyzeBudget}
          onSave={(body) => act('estimate', () => api.put(`/deals/${id}/estimate`, body), 'บันทึกการประเมินแล้ว')} />
      )}
      {tab === 'demo' && (
        <DemoTab deal={deal} isAdmin={isAdmin} busy={busy}
          onSaveLink={(url) => act('link', () => api.put(`/deals/${id}/demo-link`, { url }), url ? 'บันทึกลิงก์ Demo แล้ว' : 'ลบลิงก์ Demo แล้ว')} />
      )}
      {tab === 'team' && <TeamTab deal={deal} reload={reload} />}
      {tab === 'docs' && <DocsTab deal={deal} isAdmin={isAdmin} canSell={canSell} busy={busy} act={act} reload={reload} close={close} setClose={setClose} />}
    </>
  );
}

function RequirementTab({ deal, canEdit, canAnalyze, busy, onSave, onAnalyze, onSaveAnalyze }) {
  const [f, setF] = useState(deal);
  useEffect(() => setF(deal), [deal]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const v = (k) => f[k] ?? '';
  const dirty = ['title', 'customer_name', 'customer_company', 'customer_email', 'customer_phone', 'customer_tax_id', 'customer_address', 'project_type', 'budget', 'deadline', 'requirement', 'requirement_checks']
    .some((k) => String(f[k] ?? '') !== String(deal[k] ?? ''));

  return (
    <div className="grid g-main">
      <div className="card stack">
        <Field label="ชื่องาน"><input value={v('title')} onChange={set('title')} disabled={!canEdit} /></Field>
        <div className="field">
          <span>เช็คลิสต์ Requirement — ติ๊กสิ่งที่ลูกค้าต้องการ</span>
          <RequirementChecklist value={f.requirement_checks ?? []} onChange={(list) => setF({ ...f, requirement_checks: list })} disabled={!canEdit} />
        </div>
        <Field label="ข้อมูลเพิ่มเติม">
          <textarea style={{ minHeight: 160 }} value={v('requirement')} onChange={set('requirement')} disabled={!canEdit}
            placeholder="อธิบายสิ่งที่ลูกค้าต้องการ: ใครใช้งาน ทำอะไรได้บ้าง ต้องเชื่อมกับระบบใด มีข้อจำกัดอะไร" />
        </Field>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">ยิ่งรายละเอียดชัด ราคาและระยะเวลาที่ประเมินยิ่งแม่น</span>
          <div className="row">
            {canEdit && <button className="btn" disabled={!dirty || busy} onClick={() => onSave(f)}>อัปเดตข้อมูล</button>}
            {canAnalyze && (
              <button className="btn primary" disabled={Boolean(busy) || dirty} onClick={onAnalyze} title={dirty ? 'บันทึกก่อนวิเคราะห์' : ''}>
                <Icon name="spark" />{busy === 'analyze' ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ Requirement'}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="card stack">
        <h2>ข้อมูลลูกค้า</h2>
        <Field label="ชื่อผู้ติดต่อ"><input value={v('customer_name')} onChange={set('customer_name')} disabled={!canEdit} /></Field>
        <Field label="บริษัท / หน่วยงาน"><input value={v('customer_company')} onChange={set('customer_company')} disabled={!canEdit} /></Field>
        <div className="grid g2">
          <Field label="โทรศัพท์ (ตัวเลขไม่เกิน 10 หลัก)"><input type="tel" inputMode="numeric" maxLength={10} value={v('customer_phone')} onChange={(e) => setF({ ...f, customer_phone: phoneDigits(e.target.value) })} disabled={!canEdit} /></Field>
          <Field label="อีเมล"><input value={v('customer_email')} onChange={set('customer_email')} disabled={!canEdit} /></Field>
        </div>
        <Field label="เลขประจำตัวผู้เสียภาษี"><input value={v('customer_tax_id')} onChange={set('customer_tax_id')} disabled={!canEdit} /></Field>
        <Field label="ที่อยู่ (สำหรับออกเอกสาร)"><textarea style={{ minHeight: 70 }} value={v('customer_address')} onChange={set('customer_address')} disabled={!canEdit} /></Field>
        <div className="grid g2">
          <Field label="งบประมาณลูกค้า (บาท)"><input type="number" min="0" value={v('budget')} onChange={set('budget')} disabled={!canEdit} /></Field>
          <Field label="วันที่ต้องการใช้งาน"><input type="date" value={v('deadline')} onChange={set('deadline')} disabled={!canEdit} /></Field>
        </div>
        {canEdit && canAnalyze && (
          <>
            <button className="btn primary" disabled={Boolean(busy)} onClick={() => onSaveAnalyze(f)}>
              <Icon name="spark" />{busy === 'analyze' ? 'กำลังวิเคราะห์…' : 'บันทึกและวิเคราะห์ตามงบประมาณ'}
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              {Number(f.budget) > 0
                ? 'ระบบจะปรับ Requirement ให้ราคาก่อน VAT ไม่เกินงบ ส่วนที่เกินจะเลื่อนไปเฟส 2 (ดูได้ที่แท็บประเมินราคา)'
                : 'ใส่งบประมาณที่ลูกค้าแจ้ง ระบบจะปรับขอบเขตงานให้พอดีงบ ถ้าไม่ระบุจะวิเคราะห์ขอบเขตเต็ม'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ผลการปรับขอบเขตให้พอดีงบลูกค้า (คำนวณตอนวิเคราะห์ Requirement)
const FIT_LABEL = { within: ['ราคาอยู่ในงบ', 'ok'], fitted: ['ปรับขอบเขตให้พอดีงบแล้ว', 'warn'], over: ['ขอบเขตขั้นต่ำยังเกินงบ', 'danger'] };
// ช่องบันทึกงบประมาณลูกค้า + ปุ่มวิเคราะห์ตามงบ (ราคาเทียบก่อน VAT)
function BudgetInput({ deal, busy, onRun }) {
  const [value, setValue] = useState(deal.budget ?? '');
  useEffect(() => setValue(deal.budget ?? ''), [deal.budget]);
  return (
    <div className="row m-wrap" style={{ alignItems: 'flex-end' }}>
      <Field label="งบประมาณลูกค้า (บาท ก่อน VAT)" style={{ flex: 1, minWidth: 200 }}>
        <input type="number" min="0" placeholder="ไม่ระบุ = วิเคราะห์ขอบเขตเต็ม" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <button className="btn" disabled={Boolean(busy)} onClick={() => onRun(value)}>
        <Icon name="spark" />{busy === 'analyze' ? 'กำลังวิเคราะห์…' : 'บันทึกงบและวิเคราะห์ตามงบ'}
      </button>
    </div>
  );
}

function BudgetFit({ deal, fit, busy, onBudget, canAdd, onAdd }) {
  if (!fit) {
    return (
      <div className="card">
        <div className="card-head"><h2>วิเคราะห์ตามงบประมาณลูกค้า</h2><span className="small muted">ยังไม่ได้ระบุงบ</span></div>
        <p className="small muted" style={{ marginBottom: 12 }}>บันทึกงบที่ลูกค้าแจ้ง ระบบจะวิเคราะห์ใหม่และปรับขอบเขตให้ราคาไม่เกินงบ ส่วนที่ตัดออกจะเลื่อนไปเฟส 2</p>
        <BudgetInput deal={deal} busy={busy} onRun={onBudget} />
      </div>
    );
  }
  const [label, toneName] = FIT_LABEL[fit.status];
  const inScope = new Set(deal.items.map((i) => i.title));
  return (
    <div className="card">
      <div className="card-head"><h2>วิเคราะห์ตามงบประมาณลูกค้า</h2><Badge tone={toneName}>{label}</Badge></div>
      {onBudget && <div style={{ marginBottom: 14 }}><BudgetInput deal={deal} busy={busy} onRun={onBudget} /></div>}
      <dl className="kv">
        <dt>งบประมาณลูกค้า (ก่อน VAT)</dt><dd>{money2(fit.budget)}</dd>
        <dt>ราคาตามขอบเขตเต็ม</dt><dd>{money2(fit.original_net)}</dd>
        <dt>ราคาหลังปรับขอบเขต</dt><dd>{money2(fit.fitted_net)}</dd>
        <dt>ปัจจุบัน (ก่อน VAT)</dt><dd>{money2(deal.totals.net)}</dd>
      </dl>
      {fit.status !== 'within' && (
        <ul className="plain" style={{ marginTop: 12 }}>
          {fit.deferred.length > 0 && <li>เลื่อน {fit.deferred.length} รายการไปเฟส 2 (ราคารวม {money2(fit.deferred.reduce((s, d) => s + d.price, 0))})</li>}
          {fit.trim_percent > 0 && <li>ลดกำลังคนส่วนที่เหลือ {fit.trim_percent}% — ทำแบบกระชับ เช่น ใช้ดีไซน์มาตรฐาน จำกัดรอบแก้ไข</li>}
          <li className="small muted">ราคายังคำนวณจากอัตราค่าแรงและกำไรตามตั้งค่า ไม่ต่ำกว่าต้นทุน</li>
        </ul>
      )}
      {fit.status === 'over' && <div className="notice" style={{ marginTop: 12 }}>ตัดเหลือเฉพาะงานที่ขาดไม่ได้แล้วยังเกินงบ ฿{money2(fit.fitted_net - fit.budget)} — ควรคุยกับลูกค้าเรื่องเพิ่มงบหรือแบ่งจ่ายเป็นเฟส</div>}
      {fit.deferred.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>เลื่อนไปเฟส 2</th><th className="right">ราคา (ก่อน VAT)</th><th /></tr></thead>
            <tbody>
              {fit.deferred.map((d, i) => (
                <tr key={i}>
                  <td>{d.title}<div className="small muted">{d.description}</div></td>
                  <td className="right num">{money2(d.price)}</td>
                  <td className="right nowrap">
                    {inScope.has(d.title) ? <span className="small muted">เพิ่มกลับแล้ว</span>
                      : canAdd && <button className="btn sm ghost" onClick={() => onAdd(d)}><Icon name="plus" />เพิ่มกลับ</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EstimateTab({ deal, canPrice, limited, canSell, canAnalyze, busy, onSave, onAnalyze, onBudgetAnalyze }) {
  const { meta, user } = useApp();
  const [edit, setEdit] = useState(null); // { items, discount, duration_days }
  const { totals, feasibility: fz, analysis } = deal;
  const locked = deal.status === 'won';

  if (!deal.items.length && !edit) {
    return (
      <div className="card empty">
        <p style={{ marginBottom: 14 }}>ยังไม่มีรายการงาน — วิเคราะห์ Requirement เพื่อให้ระบบแตกรายการงาน ราคา และระยะเวลา</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {canAnalyze && <BudgetInput deal={deal} busy={busy} onRun={onBudgetAnalyze} />}
          {canAnalyze && <button className="btn primary" disabled={Boolean(busy)} onClick={onAnalyze}><Icon name="spark" />{busy === 'analyze' ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ Requirement'}</button>}
          {canPrice && <button className="btn" onClick={() => setEdit({ items: [{ title: '', description: '', effort: {}, price_override: '' }], discount: 0, duration_days: 0 })}>กรอกเอง</button>}
        </div>
      </div>
    );
  }

  const startEdit = () => setEdit({
    items: deal.items.map((i) => ({ title: i.title, description: i.description ?? '', effort: { ...i.effort }, price_override: i.price_override ?? '' })),
    discount: deal.discount, duration_days: deal.duration_days,
  });
  const save = async () => {
    if (await onSave(edit)) setEdit(null);
  };
  const setItem = (i, patch) => setEdit({ ...edit, items: edit.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) });

  return (
    <div className="stack">
      {!edit && (
        <div className="grid g-main">
          <div className="card">
            <div className="card-head"><h2>ความเป็นไปได้ก่อนรับงาน</h2><Badge tone={tone(fz.score)}>{fz.label}</Badge></div>
            <div className="row" style={{ gap: 28, alignItems: 'center', flexWrap: 'nowrap' }}>
              <div className="ring" style={{ '--p': fz.score, '--c': FEAS_COLOR[fz.level] }}>
                <div><b className="num">{fz.score}</b><span>จาก 100</span></div>
              </div>
              <div style={{ flex: 1, display: 'grid', gap: 12 }}>
                {fz.factors.map((x) => (
                  <div key={x.key}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{x.label} <span className="small muted">· น้ำหนัก {x.weight}%</span></span>
                      <span className="num">{x.score}</span>
                    </div>
                    <Bar value={x.score} tone={tone(x.score)} />
                    <div className="small muted" style={{ marginTop: 3 }}>{x.note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>สรุปใบเสนอราคา</h2>
              <span className="small muted">{deal.duration_days} วันทำการ · {num(totals.days)} man-day</span>
            </div>
            <dl className="kv">
              <dt>รวมรายการ</dt><dd>{money2(totals.subtotal)}</dd>
              <dt>ส่วนลด</dt><dd>{totals.discount ? `−${money2(totals.discount)}` : '—'}</dd>
              <dt>มูลค่าก่อน VAT</dt><dd>{money2(totals.net)}</dd>
              <dt>VAT {totals.vat_percent}%</dt><dd>{money2(totals.vat)}</dd>
              <dt className="total">รวมทั้งสิ้น</dt><dd className="total">฿{money2(totals.total)}</dd>
            </dl>
            {totals.subtotal > 0 && totals.net < totals.cost && (
              <div className="notice" style={{ marginTop: 14 }}>ราคาก่อน VAT ต่ำกว่าต้นทุนค่าแรงของทีม — ควรตรวจสอบก่อนยืนยันกับลูกค้า</div>
            )}
            {!['sales', 'staff'].includes(user.role) && (
              <p className="small muted" style={{ marginTop: 14 }}>
                ต้นทุนค่าแรง {money(totals.cost)} · กำไรขั้นต้น {money(totals.net - totals.cost)}
                {totals.net > 0 && ` (${Math.round(((totals.net - totals.cost) / totals.net) * 100)}%)`}
              </p>
            )}
          </div>
        </div>
      )}

      {!edit && analysis && (
        <div className="card">
          <div className="card-head">
            <h2>ผลวิเคราะห์ Requirement</h2>
            <span className="small muted">{analysis.source === 'claude' ? 'วิเคราะห์โดย Claude' : 'ประเมินเบื้องต้นจากคำสำคัญ'}</span>
          </div>
          <p style={{ color: 'var(--ink-2)' }}>{analysis.summary}</p>
          <div className="grid g3" style={{ marginTop: 16 }}>
            {[['ความเสี่ยง', analysis.risks], ['สมมติฐาน', analysis.assumptions], ['คำถามที่ควรถามลูกค้า', analysis.questions]].map(([title, list]) => (
              <div key={title}>
                <h3>{title}</h3>
                {list?.length ? <ul className="plain">{list.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="small muted" style={{ marginTop: 6 }}>ไม่มี</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!edit && (analysis?.budget_fit || canAnalyze) && (
        <BudgetFit deal={deal} fit={analysis?.budget_fit} busy={busy} onBudget={canAnalyze ? onBudgetAnalyze : null} canAdd={canPrice && !locked} onAdd={(it) => onSave({
          items: [...deal.items.map((i) => ({ title: i.title, description: i.description ?? '', effort: i.effort, price_override: i.price_override ?? '' })), { title: it.title, description: it.description ?? '', effort: it.effort, price_override: '' }],
          discount: deal.discount, duration_days: deal.duration_days,
        })} />
      )}

      <div className="card flush">
        <div className="card-head">
          <h2>รายการงาน</h2>
          {canPrice && !locked && !edit && <button className="btn sm" onClick={startEdit}>แก้ไขรายการและราคา (ต่อรอง)</button>}
          {!canPrice && canSell && !locked && <span className="small muted">ผู้ดูแลระบบหรือผู้ถือหุ้นเป็นผู้ปรับราคาและรายการ</span>}
        </div>

        {!edit ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: 36 }}>#</th><th>รายการ</th><th>กำลังคน (man-day)</th><th className="right">วัน</th><th className="right">ราคา (บาท)</th></tr></thead>
              <tbody>
                {deal.items.map((it, i) => (
                  <tr key={it.id}>
                    <td className="muted num">{i + 1}</td>
                    <td>{it.title}<div className="small muted">{it.description}</div></td>
                    <td>{Object.entries(it.effort).map(([c, d]) => <span key={c} className="chip">{c} {d}</span>)}</td>
                    <td className="right num">{it.days}</td>
                    <td className="right num">{money2(it.price)}{it.price_override != null && <div className="small muted">กำหนดเอง</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '0 24px 22px' }} className="stack">
            {limited && (
              <div className="notice info">
                ลดราคาได้ไม่เกิน {deal.max_sales_discount_percent}% จากราคาตั้งต้น ฿{money2(deal.price_base)} — ราคาก่อน VAT ต้องไม่ต่ำกว่า <b>฿{money2(deal.price_min)}</b> ถ้าต้องลดมากกว่านี้ ให้ผู้ถือหุ้นหรือผู้ดูแลระบบปรับให้
              </div>
            )}
            {edit.items.map((it, i) => (
              <div key={i} style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16 }} className="stack">
                <div className="row m-wrap" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <div className="stack m-full" style={{ flex: 1, gap: 8 }}>
                    <input placeholder="ชื่อรายการ" value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} aria-label="ชื่อรายการ" />
                    <input placeholder="รายละเอียด" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} aria-label="รายละเอียด" />
                  </div>
                  <Field label="ราคากำหนดเอง" style={{ width: 150 }}>
                    <input type="number" min="0" placeholder="คำนวณอัตโนมัติ" value={it.price_override} onChange={(e) => setItem(i, { price_override: e.target.value })} />
                  </Field>
                  <button className="btn ghost danger sm" style={{ marginTop: 22 }} onClick={() => setEdit({ ...edit, items: edit.items.filter((_, n) => n !== i) })} aria-label="ลบรายการ"><Icon name="trash" /></button>
                </div>
                <div className="row">
                  {Object.entries(it.effort).map(([code, d]) => (
                    <label key={code} className="row" style={{ gap: 4 }}>
                      <span className="small">{code}</span>
                      <input className="inline-input" type="number" min="0" step="0.5" style={{ width: 70 }} value={d}
                        onChange={(e) => setItem(i, { effort: { ...it.effort, [code]: e.target.value } })} />
                    </label>
                  ))}
                  <select className="inline-input" style={{ width: 'auto' }} value="" aria-label="เพิ่มตำแหน่ง"
                    onChange={(e) => e.target.value && setItem(i, { effort: { ...it.effort, [e.target.value]: 1 } })}>
                    <option value="">+ ตำแหน่ง</option>
                    {meta.positions.filter((p) => !(p.code in it.effort)).map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
                  </select>
                  <span className="small muted">ใส่ 0 เพื่อเอาตำแหน่งออก</span>
                </div>
              </div>
            ))}
            <div className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16, alignItems: 'flex-end' }}>
              <button className="btn sm" onClick={() => setEdit({ ...edit, items: [...edit.items, { title: '', description: '', effort: {}, price_override: '' }] })}><Icon name="plus" />เพิ่มรายการ</button>
              <div style={{ flex: 1 }} />
              <Field label="ส่วนลด (บาท)" style={{ width: 150 }}><input type="number" min="0" value={edit.discount} onChange={(e) => setEdit({ ...edit, discount: e.target.value })} /></Field>
              <Field label="ระยะเวลา (วันทำการ)" style={{ width: 160 }}><input type="number" min="0" value={edit.duration_days} onChange={(e) => setEdit({ ...edit, duration_days: e.target.value })} /></Field>
              <button className="btn" onClick={() => setEdit(null)}>ยกเลิก</button>
              <button className="btn primary" disabled={Boolean(busy)} onClick={save}>บันทึกการประเมิน</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ผู้ถือหุ้นเลือก dev รับงาน และห้องคุยงานระหว่างพนักงานขายกับ dev
function TeamTab({ deal, reload }) {
  const { user, run } = useApp();
  const canAssign = ['admin', 'shareholder'].includes(user.role);
  return (
    <div className="grid g-main">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>คุยงาน</h2>
            <p className="small muted">พนักงานขาย {deal.sales_name ?? '—'} · dev {deal.dev_name ?? 'ยังไม่ได้เลือก'}{deal.dev_name && (deal.dev_accepted_at ? ' (รับงานแล้ว)' : ' (รอกดรับงาน)')}</p>
          </div>
        </div>
        <DealChat dealId={deal.id} hint={deal.dev_name ? undefined : 'ยังไม่มี dev รับงานนี้ — ผู้ถือหุ้นจะเป็นผู้เลือก dev'} />
      </div>
      <div className="card stack">
        <h2>dev ที่รับงาน</h2>
        {deal.dev_name
          ? (deal.dev_accepted_at
            ? <div className="notice info"><b>{deal.dev_name}</b> กดรับงานแล้ว {date(deal.dev_accepted_at)} — dev ประเมินความเป็นไปได้ คุยงานที่นี่ และส่งลิงก์ Demo มาที่แท็บ “ลิงก์ Demo”</div>
            : <div className="notice">ส่งงานให้ <b>{deal.dev_name}</b> แล้ว — รอ dev กดรับงาน (แจ้งเตือน dev แล้ว)</div>)
          : <div className="notice">
              {deal.items.length === 0 && !canAssign
                ? 'ยังไม่ได้ส่งงานให้ dev — กด “วิเคราะห์ Requirement” ก่อน ระบบจะแจ้งผู้ถือหุ้นให้เลือก dev รับงาน'
                : `ยังไม่ได้ส่งงานให้ dev — dev จะเริ่มงานได้เมื่อผู้ถือหุ้นกดเลือก${canAssign ? 'จากรายชื่อด้านล่าง' : ' (แจ้งผู้ถือหุ้นแล้ว)'}`}
            </div>}
        {canAssign && <AssignDev deal={deal} onDone={reload} run={run} />}
      </div>
    </div>
  );
}

function AssignDev({ deal, onDone, run }) {
  const [devs, reloadDevs] = useData('/deals/dev-candidates');
  const pick = async (devId) => {
    if (await run(() => api.put(`/deals/${deal.id}/dev`, { dev_id: devId }), devId ? 'เลือก dev แล้ว — แจ้งเตือน dev และพนักงานขายเรียบร้อย' : 'ยกเลิก dev ของงานนี้แล้ว')) {
      reloadDevs();
      onDone();
    }
  };
  if (!devs) return null;
  if (devs.length === 0) return <p className="muted">ยังไม่มีสมาชิกสิทธิ์พนักงาน — เพิ่มได้ที่เมนูสมาชิก</p>;
  return (
    <>
      <ul className="list">
        {devs.map((d) => {
          const current = d.name === deal.dev_name;
          return (
            <li key={d.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <div className="name-cell">
                <Avatar user={d} size={36} />
                <div>
                {d.name} <span className="small muted">· {d.position ?? 'ไม่ระบุตำแหน่ง'}</span>
                <div className="small muted">งานขายที่ถืออยู่ {d.open_deals} · งานโครงการค้าง {d.open_tasks}</div>
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Badge tone={d.free ? 'ok' : 'warn'}>{d.free ? 'ว่าง' : 'มีงาน'}</Badge>
                {current ? <Badge tone={deal.dev_accepted_at ? 'ok' : 'blue'}>{deal.dev_accepted_at ? 'รับงานแล้ว' : 'รอกดรับงาน'}</Badge> : <button className="btn sm" onClick={() => pick(d.id)}>เลือก</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {deal.dev_name && <div><button className="btn ghost sm danger" onClick={() => pick(null)}>ยกเลิก dev ของงานนี้</button></div>}
    </>
  );
}

// แท็บ Demo: เหลือเฉพาะลิงก์ Demo ที่ dev/ผู้ดูแลระบบแนบไว้สำหรับนำเสนอลูกค้า
function DemoTab({ deal, isAdmin, busy, onSaveLink }) {
  const { toast } = useApp();
  const [link, setLink] = useState(deal.demo_url ?? '');
  useEffect(() => setLink(deal.demo_url ?? ''), [deal.demo_url]);
  const copy = () => navigator.clipboard.writeText(deal.demo_url).then(() => toast('คัดลอกลิงก์แล้ว'), () => toast('คัดลอกไม่สำเร็จ กรุณาคัดลอกจากช่องลิงก์', 'error'));
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>ลิงก์ Demo สำหรับนำเสนอลูกค้า</h2>
          <p className="small muted">dev ที่รับงานหรือผู้ดูแลระบบแนบลิงก์หน้าเว็บ Demo ให้พนักงานขายดูก่อนนำไปเสนอลูกค้า</p>
        </div>
      </div>
      {deal.demo_url ? (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <a href={deal.demo_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.demo_url}</a>
          <a className="btn primary" href={deal.demo_url} target="_blank" rel="noopener noreferrer">เปิดลิงก์</a>
          <button className="btn" onClick={copy}>คัดลอกลิงก์</button>
        </div>
      ) : <p className="muted">{isAdmin ? 'ยังไม่ได้แนบลิงก์ — วางลิงก์ด้านล่างแล้วกดบันทึก' : 'ยังไม่มีลิงก์ Demo — dev ที่รับงานจะแนบให้เมื่อพร้อม'}</p>}
      {isAdmin && (
        <div className="row" style={{ flexWrap: 'nowrap', marginTop: 14 }}>
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://demo.example.com" aria-label="ลิงก์ Demo" />
          <button className="btn primary" disabled={Boolean(busy) || link.trim() === (deal.demo_url ?? '')} onClick={() => onSaveLink(link.trim())}>{deal.demo_url ? 'อัปเดตลิงก์' : 'บันทึกลิงก์'}</button>
          {deal.demo_url && <button className="btn ghost danger" disabled={Boolean(busy)} onClick={() => onSaveLink('')}>ลบลิงก์</button>}
        </div>
      )}
    </div>
  );
}

// หมายเหตุ / เงื่อนไขเพิ่มเติมที่แสดงท้ายใบเสนอราคา
function QuoteNote({ deal, canEdit, act }) {
  const [text, setText] = useState(deal.quote_note ?? '');
  useEffect(() => setText(deal.quote_note ?? ''), [deal.quote_note]);
  const dirty = text.trim() !== (deal.quote_note ?? '').trim();
  const issued = deal.documents.some((d) => d.type === 'quotation' && d.status === 'issued');
  return (
    <div className="card stack">
      <div>
        <h2>หมายเหตุ / เงื่อนไขเพิ่มเติมในใบเสนอราคา</h2>
        <p className="small muted">
          แสดงท้ายใบเสนอราคา เช่น ขอบเขตที่ไม่รวม จำนวนรอบการแก้ไข หรือสิ่งที่ลูกค้าต้องเตรียม
          {issued && ' · ใบเสนอราคาที่ออกไปแล้วยังเป็นข้อความเดิม ต้องออกฉบับใหม่จึงจะแสดงข้อความนี้'}
        </p>
      </div>
      <textarea style={{ minHeight: 100 }} value={text} maxLength={3000} disabled={!canEdit} onChange={(e) => setText(e.target.value)}
        placeholder="เช่น ราคานี้รวมการแก้ไขงานได้ 2 รอบ · ลูกค้าจัดเตรียมรูปภาพและเนื้อหา" aria-label="หมายเหตุในใบเสนอราคา" />
      {canEdit && (
        <div>
          <button className="btn" disabled={!dirty} onClick={() => act('note', () => api.put(`/deals/${deal.id}`, { quote_note: text.trim() }), 'บันทึกหมายเหตุแล้ว')}>บันทึกหมายเหตุ</button>
        </div>
      )}
    </div>
  );
}

function DocsTab({ deal, isAdmin, canSell, busy, act, reload, close, setClose }) {
  const { run, user } = useApp();
  const nav = useNavigate();
  const [pay, setPay] = useState(null); // { doc, date, method }
  const closed = deal.status === 'won' || deal.status === 'lost';
  // บันทึกงบประมาณ/ข้อมูลลูกค้า แล้ววิเคราะห์ Requirement: พนักงานขาย และผู้ถือหุ้น
  const canReq = canSell || user.role === 'shareholder';
  const hasItems = deal.items.length > 0;

  const submitClose = async () => {
    const out = await act('close', () => api.post(`/deals/${deal.id}/close`, close), close.result === 'won' ? 'ปิดการขายแล้ว — เปิดโครงการและออกเอกสารเรียบร้อย' : 'บันทึกผลแล้ว');
    if (out) {
      setClose(null);
      if (out.project_id && PROJECTS.includes(user.role)) nav(`/projects/${out.project_id}`);
    }
  };
  const submitPay = async () => {
    if (await run(() => api.post(`/documents/${pay.doc.id}/pay`, { date: pay.date, method: pay.method }), 'รับชำระและออกใบเสร็จแล้ว')) {
      setPay(null);
      reload();
    }
  };
  const docStatus = (d) => (d.status === 'void' ? ['ยกเลิก', ''] : d.status === 'paid' ? ['ชำระแล้ว', 'ok'] : d.type === 'invoice' ? (d.due_at < todayStr() ? ['เกินกำหนด', 'danger'] : ['รอชำระ', 'warn']) : ['ออกแล้ว', 'blue']);

  return (
    <div className="stack">
      {deal.status === 'won' ? <DealExtras deal={deal} /> : <QuoteNote deal={deal} canEdit={canSell && !closed} act={act} />}
      <div className="card flush">
        <div className="card-head">
          <h2>เอกสาร</h2>
          {canSell && !closed && <button className="btn sm" disabled={!hasItems || Boolean(busy)} onClick={() => act('quote', () => api.post(`/deals/${deal.id}/quote`), 'ออกใบเสนอราคาแล้ว')}>ออกใบเสนอราคา{deal.documents.some((d) => d.type === 'quotation') ? 'ฉบับใหม่' : ''}</button>}
        </div>
        {deal.documents.length === 0 ? <div className="empty">ยังไม่มีเอกสาร — ออกใบเสนอราคาเมื่อประเมินราคาเรียบร้อย</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>เอกสาร</th><th>วันที่</th><th>ครบกำหนด / ยืนราคาถึง</th><th className="right">จำนวนเงิน</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {deal.documents.map((d) => {
                  const [label, t] = docStatus(d);
                  return (
                    <tr key={d.id}>
                      <td className="nowrap">{DOC_TYPE[d.type]}<div className="small muted">{d.number}</div></td>
                      <td className="nowrap">{date(d.issued_at)}</td>
                      <td className="nowrap">{date(d.due_at)}</td>
                      <td className="right num">{money2(d.amount)}</td>
                      <td><Badge tone={t}>{label}</Badge></td>
                      <td className="right nowrap">
                        {isAdmin && d.type === 'invoice' && d.status === 'issued' && <button className="btn sm" onClick={() => setPay({ doc: d, date: todayStr(), method: 'โอนเงิน' })}>รับชำระ</button>}{' '}
                        <a className="btn sm ghost" href={`/print/${d.id}`} target="_blank" rel="noreferrer" aria-label={`พิมพ์ ${d.number}`} title="เปิดเอกสารเพื่อพิมพ์"><Icon name="print" /></a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2>ปิดงาน</h2>
        {deal.status === 'won' && (
          <>
            <div className="notice info">ปิดการขายเมื่อ {date(deal.closed_at)} — ระบบออกสัญญา ใบแจ้งหนี้ตามงวด และเปิดโครงการแล้ว</div>
            {deal.project && (PROJECTS.includes(user.role)
              ? <Link className="btn primary" to={`/projects/${deal.project.id}`}>ไปที่โครงการ {deal.project.code}</Link>
              : <p className="small muted">โครงการ {deal.project.code} — ทีมงานรับช่วงดูแลต่อ</p>)}
          </>
        )}
        {deal.status === 'lost' && <div className="notice">ไม่ได้งานนี้{deal.close_note ? ` — ${deal.close_note}` : ''}</div>}
        {!closed && (
          <>
            <p style={{ color: 'var(--ink-2)' }}>
              เมื่อลูกค้าตกลง กด “ปิดการขาย” ระบบจะออกสัญญา ใบแจ้งหนี้ตามงวดชำระ และเปิดโครงการพร้อมแบ่งงานตามตำแหน่งให้อัตโนมัติ
            </p>
            <dl className="kv">
              <dt>มูลค่ารวม VAT</dt><dd>฿{money2(deal.totals.total)}</dd>
              <dt>ระยะเวลา</dt><dd>{deal.duration_days} วันทำการ</dd>
              <dt>ความเป็นไปได้</dt><dd>{deal.feasibility.score}% · {deal.feasibility.label}</dd>
            </dl>
            <div className="row" hidden={!canSell}>
              <button className="btn primary" disabled={!hasItems} onClick={() => setClose({ result: 'won', start_date: todayStr(), note: '' })}><Icon name="check" />ปิดการขาย</button>
              <button className="btn" onClick={() => setClose({ result: 'lost', note: '' })}>ไม่ได้งาน</button>
            </div>
          </>
        )}
      </div>

      {close && (
        <Modal title={close.result === 'won' ? 'ยืนยันปิดการขาย' : 'บันทึกว่าไม่ได้งาน'} onClose={() => setClose(null)}
          footer={<><button className="btn" onClick={() => setClose(null)}>ยกเลิก</button><button className="btn primary" disabled={busy === 'close'} onClick={submitClose}>ยืนยัน</button></>}>
          <div className="stack">
            {close.result === 'won' && (
              <>
                {deal.feasibility.level !== 'go' && <div className="notice">ความเป็นไปได้อยู่ที่ {deal.feasibility.score}% ({deal.feasibility.label}) — ตรวจสอบเงื่อนไขกับลูกค้าก่อนยืนยัน</div>}
                <Field label="วันเริ่มโครงการ"><input type="date" value={close.start_date} onChange={(e) => setClose({ ...close, start_date: e.target.value })} /></Field>
                <p className="small muted">หลังยืนยันจะแก้ราคาและรายการงานไม่ได้ เอกสารจะใช้ข้อมูล ณ ตอนนี้</p>
              </>
            )}
            <Field label={close.result === 'won' ? 'หมายเหตุ (ถ้ามี)' : 'เหตุผลที่ไม่ได้งาน'}><textarea style={{ minHeight: 80 }} value={close.note} onChange={(e) => setClose({ ...close, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {pay && (
        <Modal title={`รับชำระ ${pay.doc.number}`} onClose={() => setPay(null)}
          footer={<><button className="btn" onClick={() => setPay(null)}>ยกเลิก</button><button className="btn primary" onClick={submitPay}>ยืนยันรับชำระ</button></>}>
          <div className="stack">
            <p>จำนวนเงิน <b className="num">฿{money2(pay.doc.amount)}</b> — ระบบจะออกใบเสร็จรับเงินและบันทึกรายรับ (ยอดก่อน VAT) ให้อัตโนมัติ</p>
            <div className="grid g2">
              <Field label="วันที่รับชำระ"><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
              <Field label="ช่องทาง"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option>โอนเงิน</option><option>เช็ค</option><option>เงินสด</option><option>บัตรเครดิต</option></select></Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
