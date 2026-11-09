import { useState, useEffect } from 'react';
import { sb } from '../lib/api';
import { Logo } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [needsAdmin, setNeedsAdmin] = useState(false);
  const [setup, setSetup] = useState(false);

  useEffect(() => {
    sb.rpc('icfr_has_admin').then(({ data, error }) => { if (!error && data === false) setNeedsAdmin(true); });
  }, []);

  const signIn = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is not right.' : error.message);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (setup) {
        const { data, error } = await sb.functions.invoke('icfr-admin-users', { body: { action: 'bootstrap', email: email.trim(), password, full_name: name } });
        let msg = data?.error;
        if (error) { try { msg = (await error.context?.json?.())?.error || error.message; } catch { msg = error.message; } }
        if (msg) throw new Error(msg);
      }
      await signIn();
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  };

  return (
    <div className="login-page">
      <section className="login-art" aria-hidden="true">
        <div className="brand"><Logo /><span>ICFR Hub</span></div>
        <div className="login-sheet">
          <h2>Procure to Pay, Q3 testing</h2>
          <table>
            <tbody>
              <tr><td>P2P-01</td><td>Three-way match before payment</td><td className="tick">✓</td></tr>
              <tr><td>P2P-02</td><td>Vendor master changes reviewed</td><td className="tick">✓</td></tr>
              <tr><td>P2P-03</td><td><span className="hl">Payment run approval</span></td><td className="x">✗ 1</td></tr>
              <tr><td>P2P-04</td><td>Accrual for goods not invoiced</td><td className="tick">✓</td></tr>
            </tbody>
          </table>
          <div className="stamp ok"><span className="stamp-word">Signed off</span><span className="stamp-date">Finance</span></div>
        </div>
        <p className="login-claim">Every control, every entity, tested and signed off in one place.</p>
      </section>
      <div className="login-form-side">
      <form className="login-card" onSubmit={submit}>
        <h1>{setup ? 'Set up ICFR Hub' : 'Sign in'}</h1>
        {setup
          ? <p className="muted">Create the first admin account. You will manage entities, processes, users and sign-offs. If this email already has a login on this server, use its current password.</p>
          : <p className="muted">RCMs, walkthroughs, testing and sign-offs for every entity.</p>}
        {setup && (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={setup ? 8 : undefined} />
        </div>
        {err && <div className="error-box">{err}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create admin and sign in' : 'Sign in'}</button>
        {needsAdmin && (
          <p className="small center-text">
            <button type="button" className="link" onClick={() => { setSetup((x) => !x); setErr(''); }}>
              {setup ? 'Back to sign in' : 'First time here? Set up ICFR Hub'}
            </button>
          </p>
        )}
        {!needsAdmin && <p className="muted small center-text">No account yet? Ask your ICFR admin to create one.</p>}
      </form>
      </div>
    </div>
  );
}
