import { useState } from 'react';
import { api } from '../lib.js';
import { Field, useApp } from '../components/ui.jsx';

export default function Login() {
  const { setUser } = useApp();
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api.post('/auth/login', f));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <b>ITERRA</b>
        <div>
          <h1>จาก Requirement<br />ถึงวันส่งมอบ<br />ในระบบเดียว</h1>
          <p>ขายงาน ประเมินราคา ออกเอกสาร แบ่งงานตามตำแหน่ง ติดตามความคืบหน้า และแบ่งผลประโยชน์อย่างโปร่งใส</p>
        </div>
        <span className="small" style={{ opacity: 0.6 }}>People · Ideas · Systems</span>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div>
            <h1>เข้าสู่ระบบ</h1>
            <p className="muted" style={{ marginTop: 6 }}>ระบบรับงานครบวงจรของบริษัท</p>
          </div>
          <Field label="อีเมล"><input type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="รหัสผ่าน"><input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          {error && <div className="notice" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        </form>
      </div>
    </div>
  );
}
