import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib.js';

const PATHS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  deal: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0V6a2 2 0 012-2h11M16 13h2',
  pie: 'M12 3v9h9a9 9 0 11-9-9zM15 3.5A9 9 0 0120.5 9H15z',
  cog: 'M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4M6.3 17.7l1.4-1.4m8.6-8.6l1.4-1.4',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.3a3.5 3.5 0 010 6.4M18 14.2a6.5 6.5 0 013.5 5.8',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3M12 14.5v2.5',
  bell: 'M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20a2 2 0 004 0',
  plus: 'M12 5v14M5 12h14',
  print: 'M7 8V4h10v4M7 17H5a1 1 0 01-1-1v-6a1 1 0 011-1h14a1 1 0 011 1v6a1 1 0 01-1 1h-2M7 14h10v6H7z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ภาพสมาชิก: แสดงรูป ถ้าไม่มีแสดงอักษรตัวแรกของชื่อ
export function Avatar({ user, size = 34 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  return user?.avatar
    ? <img className="avatar" style={style} src={user.avatar} alt="" />
    : <span className="avatar" style={style} aria-hidden="true">{(user?.name ?? '?').trim().charAt(0)}</span>;
}

// ย่อและครอบรูปเป็นสี่เหลี่ยมจัตุรัส 256px ก่อนส่ง เพื่อให้ไฟล์เล็ก
function resizeToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปนี้ไม่ได้')); };
    img.src = url;
  });
}

// ตัวเลือกภาพสมาชิก: value = data URL หรือ '' · onChange รับค่าใหม่
export function PhotoPicker({ name, value, onChange }) {
  const { toast } = useApp();
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('กรุณาเลือกไฟล์รูปภาพ', 'error');
    try {
      onChange(await resizeToDataUrl(file));
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <div className="row" style={{ gap: 14 }}>
      <Avatar user={{ name, avatar: value }} size={72} />
      <div className="row">
        <label className="btn sm">
          {value ? 'เปลี่ยนภาพ' : 'เลือกภาพ'}
          <input type="file" accept="image/*" onChange={pick} hidden />
        </label>
        {value && <button type="button" className="btn sm ghost danger" onClick={() => onChange('')}>ลบภาพ</button>}
        <span className="small muted">ระบบจะครอบเป็นสี่เหลี่ยมจัตุรัสและย่อให้อัตโนมัติ</span>
      </div>
    </div>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Bar({ value, tone = '' }) {
  return (
    <div className={`bar ${tone}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, hero }) {
  return (
    <div className={`card stat${hero ? ' hero' : ''}`}>
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, style }) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// เช็คลิสต์ Requirement: ติ๊กสิ่งที่ลูกค้าต้องการ (value = array ของรหัส)
export function RequirementChecklist({ value = [], onChange, disabled }) {
  const { meta } = useApp();
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="checklist" role="group" aria-label="เช็คลิสต์ Requirement">
      {meta.requirement_options.map((o) => (
        <label key={o.id} className={`check${value.includes(o.id) ? ' on' : ''}`}>
          <input type="checkbox" checked={value.includes(o.id)} disabled={disabled} onChange={() => toggle(o.id)} />
          <span><b>{o.title}</b><small>{o.desc}</small></span>
        </label>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={`tab${value === id ? ' active' : ''}`} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------- context: ผู้ใช้ + ข้อมูลอ้างอิง + toast ----------
const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = กำลังโหลด
  const [meta, setMeta] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadMeta = useCallback(() => api.get('/meta').then(setMeta).catch(() => {}), []);

  useEffect(() => {
    api.get('/auth/me').then(setUser).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    if (user) loadMeta();
  }, [user, loadMeta]);

  // เรียก API พร้อมแจ้งผล: คืนค่า undefined เมื่อผิดพลาด
  const run = useCallback(
    async (fn, okMessage) => {
      try {
        const out = await fn();
        if (okMessage) toast(okMessage);
        return out ?? true;
      } catch (e) {
        if (e.status === 401) setUser(null);
        toast(e.message, 'error');
        return undefined;
      }
    },
    [toast],
  );

  return (
    <AppCtx.Provider value={{ user, setUser, meta, loadMeta, toast, run }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

// โหลดข้อมูลจาก API พร้อมฟังก์ชัน reload
export function useData(path, deps = []) {
  const { run } = useApp();
  const [data, setData] = useState(null);
  const reload = useCallback(async () => {
    const out = await run(() => api.get(path));
    if (out !== undefined) setData(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, run, ...deps]);
  useEffect(() => {
    reload();
  }, [reload]);
  return [data, reload, setData];
}
