import { useState } from 'react';
import { api } from '../lib.js';
import { Icon, useApp } from '../components/ui.jsx';

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
      <form className="login-card" onSubmit={submit}>
        <div className="login-badge">
          <img src="/logo-mark.png" alt="ITERRA" width="480" height="296" />
        </div>
        <h1>เข้าสู่ระบบ</h1>
        <p className="login-sub">บริษัท อิเทอร์ร่า จำกัด · ITERRA CO., LTD.</p>

        <label className="login-field">
          <Icon name="user" />
          <input type="email" autoComplete="username" required placeholder="อีเมล" aria-label="อีเมล"
            value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label className="login-field">
          <Icon name="lock" />
          <input type="password" autoComplete="current-password" required placeholder="รหัสผ่าน" aria-label="รหัสผ่าน"
            value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </label>

        {error && <div className="notice" role="alert">{error}</div>}
        <button className="login-btn" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        <p className="login-help">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบเพื่อตั้งรหัสใหม่</p>
      </form>
    </div>
  );
}
