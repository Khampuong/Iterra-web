import { useState } from 'react';
import { compact, money, monthLabel } from '../lib.js';

const SERIES = [
  { key: 'income', label: 'รายรับ', color: 'var(--series-1)' },
  { key: 'expense', label: 'รายจ่าย', color: 'var(--series-2)' },
];

function niceMax(v) {
  if (v <= 0) return 1000;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= v);
}

// แท่งคู่รายรับ/รายจ่ายรายเดือน (แกนเดียว, แท่งบาง, ปลายมน, มี tooltip)
export function MonthlyBars({ data }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 240, L = 44, R = 8, T = 12, B = 28;
  const max = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expense])));
  const band = (W - L - R) / data.length;
  const bw = Math.min(18, (band - 14) / 2);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  const bar = (x, v, color) => {
    if (v <= 0) return null;
    const top = y(v), h = H - B - top, r = Math.min(4, h);
    return <path d={`M${x},${H - B} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - B} Z`} fill={color} />;
  };

  return (
    <div className="viz">
      <div className="legend" style={{ marginBottom: 8 }}>
        {SERIES.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="รายรับและรายจ่ายรายเดือน" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + band * i + band / 2;
          return (
            <g key={d.month}>
              {hover === i && <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="var(--line-2)" opacity="0.7" />}
              {bar(cx - bw - 1, d.income, SERIES[0].color)}
              {bar(cx + 1, d.expense, SERIES[1].color)}
              <text x={cx} y={H - 8} textAnchor="middle">{monthLabel(d.month)}</text>
              <rect x={L + band * i} y={T} width={band} height={H - T} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${((L + band * hover + band / 2) / W) * 100}%`, top: 34 }}>
          <div style={{ opacity: 0.7, marginBottom: 2 }}>{monthLabel(data[hover].month)} {data[hover].month.slice(0, 4)}</div>
          {SERIES.map((s) => (
            <div key={s.key}><i style={{ background: s.color }} />{s.label} {money(data[hover][s.key])}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// แท่งแนวนอนสีเดียว เทียบมูลค่าตามรายการ
export function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '12px 14px', alignItems: 'center' }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'contents' }} title={`${r.label}: ${money(r.value)}`}>
          <span>{r.label} <span className="muted small">· {r.count}</span></span>
          <div style={{ height: 14, display: 'flex' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0, background: 'var(--series-1)', borderRadius: '0 4px 4px 0' }} />
          </div>
          <span className="num right">{money(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
