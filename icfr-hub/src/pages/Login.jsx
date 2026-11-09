import { useState } from 'react';
import { sb } from '../lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Email or password is not right.' : error.message);
    setBusy(false);
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big"><span className="logo">✓</span><span>ICFR Hub</span></div>
        <p className="muted">Internal controls over financial reporting – RCMs, walkthroughs, testing and sign-offs for every entity.</p>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {err && <div className="error-box">{err}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">No account yet? Ask your ICFR admin to create one.</p>
      </form>
    </div>
  );
}
