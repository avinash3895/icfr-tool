import { useState } from 'react';
import { sb } from '../lib/api';
import { useApp } from '../lib/app';
import { ROLES } from '../lib/util';
import { Field, useToast } from '../components/ui';

export default function Account() {
  const { profile, entities } = useApp();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const change = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return toast.err('Use at least 8 characters.');
    if (pw !== pw2) return toast.err('The two passwords are different.');
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.err(error);
    setPw(''); setPw2('');
    toast.ok('Password changed.');
  };

  return (
    <div className="page narrow-page">
      <h1>My account</h1>
      <div className="card">
        <dl className="kv">
          <dt>Name</dt><dd>{profile.full_name || '—'}</dd>
          <dt>Email</dt><dd>{profile.email}</dd>
          <dt>Role</dt><dd>{ROLES[profile.role]}</dd>
          <dt>Entities</dt><dd>{entities.map((e) => e.name).join(', ') || '—'}</dd>
        </dl>
      </div>
      <form className="card" onSubmit={change}>
        <h3>Change password</h3>
        <Field label="New password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Repeat new password"><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={busy}>Change password</button>
      </form>
    </div>
  );
}
