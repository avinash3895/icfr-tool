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
    <div className='onboard auth'>
      <aside className='showcase' aria-hidden='true'>
        <div className='brand'><Logo size={34} /><span>Studio</span></div>
        <div className='showcase-body'>
          <h2>Every model.<br /><em>One beautiful studio.</em></h2>
          <p>Chat with Gemini, Claude and hundreds of models, hand big jobs to the Super Agent, and turn routines into workflows.</p>
          <ul className='showcase-list'>
            <li><span className='dot' />Bring your own keys for any provider</li>
            <li><span className='dot' />Super Agent that plans, researches and checks its work</li>
            <li><span className='dot' />Workflows that run on a schedule, even when you are away</li>
          </ul>
        </div>
        <div className='showcase-glow' />
      </aside>
      <div className='onboard-card'>
        <div className='brand mobile-only'><Logo size={34} /><span>Studio</span></div>
        <h1>{tab === 'in' ? 'Welcome back' : 'Create your studio'}</h1>
        <p className='lead'>{tab === 'in' ? 'Sign in to pick up where you left off.' : 'It takes a few seconds. No database setup needed.'}</p>
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
