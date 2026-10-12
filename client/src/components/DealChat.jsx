import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ROLE_LABEL } from '../lib.js';
import { useApp } from './ui.jsx';

// ห้องคุยงานของงานขาย ระหว่างพนักงานขายกับ dev (ผู้ถือหุ้น กรรมการ และ admin ร่วมอ่านและตอบได้)
export default function DealChat({ dealId, hint }) {
  const { run } = useApp();
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const box = useRef(null);

  const load = useCallback(() => api.get(`/deals/${dealId}/messages`).then(setMessages).catch(() => {}), [dealId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await run(() => api.post(`/deals/${dealId}/messages`, { body: text }));
    setSending(false);
    if (ok) {
      setText('');
      load();
    }
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={box} aria-live="polite">
        {messages && messages.length === 0 && <div className="empty">{hint ?? 'ยังไม่มีข้อความ — เริ่มคุยงานได้เลย'}</div>}
        {(messages ?? []).map((m) => (
          <div key={m.id} className={`chat-msg${m.mine ? ' mine' : ''}`}>
            <div className="small muted">
              {m.mine ? 'คุณ' : `${m.user_name} · ${ROLE_LABEL[m.user_role] ?? m.user_role}`} · {new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="bubble">{m.body}</div>
          </div>
        ))}
      </div>
      <form className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }} onSubmit={send}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์ข้อความ… (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)" aria-label="ข้อความ"
          style={{ minHeight: 44, height: 44 }} maxLength={2000}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
        <button className="btn primary" disabled={!text.trim() || sending}>ส่ง</button>
      </form>
    </div>
  );
}
