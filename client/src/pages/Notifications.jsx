import { useNavigate } from 'react-router-dom';
import { api } from '../lib.js';
import { useApp, useData } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

const when = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

// หน้าการแจ้งเตือนทั้งหมด: คลิกรายการเพื่อไปยังงานที่เกี่ยวข้อง
export default function NotificationsPage() {
  const nav = useNavigate();
  const { run } = useApp();
  const [rows, reload] = useData('/notifications/all');
  const unread = (rows ?? []).filter((n) => !n.read).length;

  const open = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.link) nav(n.link);
    else reload();
  };
  const readAll = async () => {
    if (await run(() => api.post('/notifications/read'), 'อ่านทั้งหมดแล้ว')) reload();
  };

  return (
    <>
      <PageHead eyebrow="ระบบ" title="การแจ้งเตือน" sub={unread ? `ยังไม่ได้อ่าน ${unread} รายการ` : 'อ่านครบทุกรายการแล้ว'}>
        {unread > 0 && <button className="btn" onClick={readAll}>ทำเครื่องหมายว่าอ่านทั้งหมด</button>}
      </PageHead>
      <div className="card flush">
        {rows && rows.length === 0 ? <div className="empty">ยังไม่มีการแจ้งเตือน</div> : (
          <ul className="note-list">
            {(rows ?? []).map((n) => (
              <li key={n.id}>
                <button type="button" className={`note-row${n.read ? '' : ' unread'}`} onClick={() => open(n)}>
                  <span className="note-dot" aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="note-title">{n.title}</span>
                    {n.body && <span className="small muted note-body">{n.body}</span>}
                  </span>
                  <span className="small muted nowrap">{when(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
