import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ALL_ROLES, api, canEditDemo, date, PROJECTS, ROLE_LABEL, WIDE } from '../lib.js';
import { Avatar, Field, Icon, Modal, PhotoPicker, useApp } from './ui.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'grid', roles: [...WIDE, 'staff'], end: true },
  { to: '/deals', label: 'งานขาย', icon: 'deal', roles: ALL_ROLES },
  { to: '/projects', label: 'โครงการ', icon: 'layers', roles: PROJECTS },
  { to: '/sharing', label: 'แบ่งผลประโยชน์', icon: 'pie', roles: WIDE },
  { to: '/finance', label: 'รายรับรายจ่าย', icon: 'wallet', roles: WIDE },
  { to: '/demos', label: 'งาน dev', icon: 'spark', roles: ALL_ROLES, when: canEditDemo },
  { to: '/members', label: 'สมาชิก', icon: 'users', roles: ['admin'] },
  { to: '/settings', label: 'ตั้งค่า', icon: 'cog', roles: ['admin'] },
];

function Notifications() {
  const [open, setOpen] = useState(false);
  const { meta } = useApp();
  const [data, setData] = useState({ alerts: [], events: [], unread: 0 });
  const loc = useLocation();
  const ref = useRef(null);

  const load = () => api.get('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && data.events.some((e) => !e.read)) api.post('/notifications/read').then(load);
  };

  return (
    <div ref={ref}>
      <button className="btn ghost bell" onClick={toggle} aria-label={`การแจ้งเตือน ${data.unread} รายการ`}>
        <Icon name="bell" />
        {data.unread > 0 && <em>{data.unread > 99 ? '99+' : data.unread}</em>}
      </button>
      {open && (
        <div className="pop">
          {data.alerts.length > 0 && <h3>ต้องดำเนินการ</h3>}
          {data.alerts.map((a, i) => (
            <Link key={i} to={a.link} className={`pop-item ${a.level}`}>
              <div>{a.title}</div>
              <div className="small muted">{a.body}</div>
            </Link>
          ))}
          <h3>ความเคลื่อนไหว <span className="small muted" style={{ fontWeight: 400 }}>· {meta?.email_enabled ? 'ส่งอีเมลแจ้งด้วย' : 'ยังไม่ได้เปิดแจ้งทางอีเมล'}</span></h3>
          {data.events.length === 0 && <div className="empty">ยังไม่มีการแจ้งเตือน</div>}
          {data.events.map((e) => (
            <Link key={e.id} to={e.link || '/notifications'} className={`pop-item${e.read ? '' : ' unread'}`}>
              <div>{e.title}</div>
              <div className="small muted">{e.body} · {date(e.created_at)}</div>
            </Link>
          ))}
          <Link to="/notifications" className="pop-all">ดูการแจ้งเตือนทั้งหมด</Link>
        </div>
      )}
    </div>
  );
}

// สมาชิกเปลี่ยนภาพของตนเอง
function PhotoModal({ onClose }) {
  const { user, setUser, run, loadMeta } = useApp();
  const [value, setValue] = useState(user.avatar ?? '');
  const save = async () => {
    const out = await run(() => api.put('/auth/avatar', { avatar: value }), 'บันทึกภาพแล้ว');
    if (out) {
      setUser({ ...user, avatar: out.avatar });
      loadMeta();
      onClose();
    }
  };
  return (
    <Modal title="ภาพของฉัน" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ยกเลิก</button><button className="btn primary" disabled={value === (user.avatar ?? '')} onClick={save}>บันทึก</button></>}>
      <PhotoPicker name={user.name} value={value} onChange={setValue} />
    </Modal>
  );
}

function PasswordModal({ onClose }) {
  const { run } = useApp();
  const [f, setF] = useState({ current: '', next: '' });
  const save = async () => {
    if (await run(() => api.put('/auth/password', f), 'เปลี่ยนรหัสผ่านแล้ว')) onClose();
  };
  return (
    <Modal title="เปลี่ยนรหัสผ่าน" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ยกเลิก</button><button className="btn primary" onClick={save}>บันทึก</button></>}>
      <div className="stack">
        <Field label="รหัสผ่านปัจจุบัน"><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function Layout() {
  const { user, setUser } = useApp();
  const [pw, setPw] = useState(false);
  const [photo, setPhoto] = useState(false);
  // จอเล็ก: เมนูเป็นลิ้นชักเลื่อนจากซ้าย เปิดด้วยปุ่มเมนู และปิดเองเมื่อเปลี่ยนหน้า
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  const logout = () => api.post('/auth/logout').finally(() => setUser(null));

  return (
    <div className="shell">
      {menu && <div className="side-back" onClick={() => setMenu(false)} />}
      <aside className={`side${menu ? ' open' : ''}`} id="main-menu">
        <div className="brand">
          <img src="/logo-mark.png" alt="ITERRA" width="480" height="296" />
          <button className="btn ghost sm menu-close" onClick={() => setMenu(false)} aria-label="ปิดเมนู"><Icon name="close" /></button>
        </div>
        {NAV.filter((n) => n.roles.includes(user.role) && (!n.when || n.when(user))).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
        <div className="side-foot">
          <div className="who">{user.name}</div>
          <div className="small muted">{ROLE_LABEL[user.role]}{user.position ? ` · ${user.position}` : ''}</div>
          <div className="row" style={{ marginTop: 10, gap: 4 }}>
            <button className="btn ghost sm" onClick={() => setPw(true)}>รหัสผ่าน</button>
            <button className="btn ghost sm" onClick={logout}><Icon name="out" />ออก</button>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="top">
          <button className="btn ghost menu-btn" onClick={() => setMenu(true)} aria-label="เปิดเมนู" aria-expanded={menu} aria-controls="main-menu"><Icon name="menu" /></button>
          <img className="top-brand" src="/logo-mark.png" alt="ITERRA" width="480" height="296" />
          <Notifications />
          <button className="top-user" title="เปลี่ยนภาพของฉัน" onClick={() => setPhoto(true)}>
            <Avatar user={user} />
            <span><b>{user.name}</b><small>{ROLE_LABEL[user.role]}{user.position ? ` · ${user.position}` : ''}</small></span>
          </button>
        </div>
        <div className="page"><Outlet /></div>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
      {photo && <PhotoModal onClose={() => setPhoto(false)} />}
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
