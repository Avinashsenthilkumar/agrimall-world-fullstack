// One sign-in for every role. The server decides where you land (§2, §3).
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import { useApp, errorMessage, ApiClientError } from '../../lib/client/AppContext';
import api from '../../lib/client/api';
import { toastSuccess } from '../../components/Toast';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await login(email, password);
      toastSuccess(`Welcome back, ${result.user.name || result.user.email}`);
      // Honour ?next= if present, otherwise the server's role-based landing.
      router.push(params.get('next') || result.redirectTo);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) flat[k] = v[0];
        setFieldErrors(flat);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.auth.forgotPassword(forgotEmail);
      setForgotSent(res.message);
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
        <div className="r-box" style={{ maxWidth: 440 }}>
          <div className="r-logo" style={{ justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
              <path d="M12 22V12M12 12C12 7 8 4 4 4C4 9 7 12 12 12ZM12 12C12 7 16 4 20 4C20 9 17 12 12 12Z"
                stroke="#D4A24C" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            Agri Mall
          </div>

          {!forgotOpen ? (
            <>
              <div className="r-tag">Sign in to your account</div>

              {params.get('registered') === '1' && (
                <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)', fontSize: 13.5, marginBottom: 16 }}>
                  Your account is ready — please sign in.
                </div>
              )}

              <form onSubmit={submit} style={{ textAlign: 'left' }}>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" type="email" autoComplete="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                  {fieldErrors.email && <small style={{ color: 'var(--red)' }}>{fieldErrors.email}</small>}
                </div>

                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" autoComplete="current-password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
                </div>

                {error && (
                  <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)', fontSize: 13.5, marginBottom: 14 }}>
                    {error}
                  </div>
                )}

                <button className="cta-full" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign In'}
                </button>
              </form>

              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 16, textAlign: 'center' }}>
                <span style={{ color: 'var(--orange)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => { setForgotOpen(true); setForgotEmail(email); }}>
                  Forgot your password?
                </span>
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                New customer?{' '}
                <span style={{ color: 'var(--green)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => router.push('/register')}>Create an account</span>
                {' · '}Nursery?{' '}
                <span style={{ color: 'var(--green)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => router.push('/seller/onboard')}>Register to sell</span>
              </p>
            </>
          ) : (
            <>
              <div className="r-tag">Reset your password</div>
              {forgotSent ? (
                <>
                  <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '14px 16px',
                    borderRadius: 'var(--radius-sm)', fontSize: 13.5, marginBottom: 16, textAlign: 'left' }}>
                    {forgotSent}
                  </div>
                  <button className="cta-full" onClick={() => { setForgotOpen(false); setForgotSent(null); }}>
                    Back to sign in
                  </button>
                </>
              ) : (
                <form onSubmit={sendReset} style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 14 }}>
                    Enter your email and we will send you a link to choose a new password.
                  </p>
                  <div className="field">
                    <label htmlFor="femail">Email</label>
                    <input id="femail" type="email" required value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <button className="cta-full" type="submit" disabled={busy}>
                    {busy ? 'Sending…' : 'Send reset link'}
                  </button>
                  <p style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
                    <span style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                      onClick={() => setForgotOpen(false)}>← Back to sign in</span>
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
