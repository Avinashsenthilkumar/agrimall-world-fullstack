'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import api from '../../lib/client/api';
import { errorMessage } from '../../lib/client/AppContext';

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LeafParticles />
      <div className="role-screen">
        <div className="r-box" style={{ maxWidth: 420 }}>
          <div className="r-logo" style={{ justifyContent: 'center' }}>🌿 Agri Mall</div>
          {!token ? (
            <>
              <div className="r-tag">Reset link missing</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 18 }}>
                This page needs the link from your reset email.
              </p>
              <button className="cta-full" onClick={() => router.push('/login')}>Back to sign in</button>
            </>
          ) : done ? (
            <>
              <div className="r-tag">Password changed</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 18 }}>
                Your password has been updated and all other devices were signed out.
              </p>
              <button className="cta-full" onClick={() => router.push('/login')}>Sign in</button>
            </>
          ) : (
            <>
              <div className="r-tag">Choose a new password</div>
              <form onSubmit={submit} style={{ textAlign: 'left' }}>
                <div className="field">
                  <label>New password</label>
                  <input type="password" autoComplete="new-password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
                </div>
                <div className="field">
                  <label>Confirm new password</label>
                  <input type="password" autoComplete="new-password" required value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} />
                </div>
                {error && (
                  <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 13px',
                    borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 12 }}>{error}</div>
                )}
                <button className="cta-full" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Change my password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
