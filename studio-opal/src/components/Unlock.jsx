import { useState } from 'react';
import { Logo } from './Icons';
import { errText } from '../lib/util';

// Shown when this browser has a Studio login but not the saved connection yet.
export default function Unlock({ name, onUnlock, onReconnect, initialError }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await onUnlock(pass); } catch (err) { setError(errText(err)); setBusy(false); }
  };
  return (
    <div className='onboard'>
      <div className='onboard-card'>
        <div className='brand'><Logo size={34} /><span>Studio</span></div>
        <h1>Welcome back, {name}</h1>
        <p className='lead'>Enter your password to open your saved connection on this browser. You will not need to connect Supabase again.</p>
        <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={submit}>
          {error && <div className='banner error' style={{ margin: 0 }}>{error}</div>}
          <div>
            <label className='label' htmlFor='up'>Password</label>
            <input id='up' className='field' type='password' autoComplete='current-password' autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          <button className='btn primary' style={{ minHeight: 48 }} disabled={busy || !pass}>{busy ? 'Opening...' : 'Unlock'}</button>
          <button type='button' className='btn ghost small' onClick={onReconnect}>Skip for now and use this device</button>
        </form>
      </div>
    </div>
  );
}
