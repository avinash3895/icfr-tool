import { useState } from 'react';
import { Logo } from './Icons';
import { signInWithUsername, signUp } from '../lib/account';
import { errText } from '../lib/util';

export default function Login({ initialError, onSignedIn }) {
  const [tab, setTab] = useState('in');
  const [error, setError] = useState(initialError || '');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [email, setEmail] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = tab === 'in' ? await signInWithUsername(user, pass) : await signUp(user, pass, email);
      onSignedIn(u, pass);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <div className='onboard'>
      <div className='onboard-card'>
        <div className='brand'><Logo size={34} /><span style={{ color: '#0f2329' }}>Studio</span></div>
        <h1>Chat, and build workflows that work your way</h1>
        <p className='lead'>Sign in once. Your connection to your own database is saved with your account, so any browser you sign in on is ready to go.</p>
        <div className='tabs' role='tablist' aria-label='Sign in or create account'>
          <button role='tab' aria-selected={tab === 'in'} className={tab === 'in' ? 'on' : ''} onClick={() => { setTab('in'); setError(''); }}>Sign in</button>
          <button role='tab' aria-selected={tab === 'up'} className={tab === 'up' ? 'on' : ''} onClick={() => { setTab('up'); setError(''); }}>Create account</button>
        </div>
        <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={submit}>
          {error && <div className='banner error' style={{ margin: 0 }}>{error}</div>}
          <div>
            <label className='label' htmlFor='lu'>Username</label>
            <input id='lu' className='field' autoComplete='username' autoCapitalize='none' spellCheck='false' value={user} onChange={(e) => setUser(e.target.value)} />
            {tab === 'up' && <div className='hint' style={{ marginTop: 6 }}>3 to 30 characters: letters, numbers, dots, dashes or underscores.</div>}
          </div>
          <div>
            <label className='label' htmlFor='lp'>Password</label>
            <div className='inline'>
              <input id='lp' className='field' type={show ? 'text' : 'password'} autoComplete={tab === 'in' ? 'current-password' : 'new-password'} value={pass} onChange={(e) => setPass(e.target.value)} />
              <button type='button' className='btn' onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
            </div>
            {tab === 'up' && <div className='hint' style={{ marginTop: 6 }}>At least 8 characters.</div>}
          </div>
          {tab === 'up' && (
            <div>
              <label className='label' htmlFor='le'>Email (optional)</label>
              <input id='le' className='field' type='email' autoComplete='email' value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          <button className='btn primary' style={{ minHeight: 48 }} disabled={busy || !user.trim() || !pass}>{busy ? 'Please wait...' : tab === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
      </div>
    </div>
  );
}
