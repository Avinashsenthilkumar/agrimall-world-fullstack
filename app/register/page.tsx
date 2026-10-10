// Customer registration (§6).
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import api from '../../lib/client/api';
import { errorMessage, ApiClientError, useApp } from '../../lib/client/AppContext';
import { toastSuccess } from '../../components/Toast';

export default function RegisterPage() {
  const router = useRouter();
  const { refreshUser } = useApp();

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (form.password !== form.confirm) {
      setFieldErrors({ confirm: 'The two passwords do not match.' });
      return;
    }

    setBusy(true);
    try {
      await api.auth.register({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
      });
      await refreshUser();
      toastSuccess('Welcome to Agri Mall!');
      router.push('/customer');
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) flat[k] = v.join(' ');
        setFieldErrors(flat);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LeafParticles />
      <div className="role-screen">
        <div className="r-box" style={{ maxWidth: 460 }}>
          <div className="r-logo" style={{ justifyContent: 'center' }}>🌿 Agri Mall</div>
          <div className="r-tag">Create your account</div>

          <form onSubmit={submit} style={{ textAlign: 'left' }}>
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" required value={form.name} onChange={set('name')} placeholder="e.g. Anjali Menon" />
              {fieldErrors.name && <small style={{ color: 'var(--red)' }}>{fieldErrors.name}</small>}
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={form.email}
                onChange={set('email')} placeholder="you@example.com" />
              {fieldErrors.email && <small style={{ color: 'var(--red)' }}>{fieldErrors.email}</small>}
            </div>
            <div className="field">
              <label htmlFor="phone">Mobile number <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input id="phone" inputMode="numeric" value={form.phone} onChange={set('phone')} placeholder="98400 11223" />
              {fieldErrors.phone && <small style={{ color: 'var(--red)' }}>{fieldErrors.phone}</small>}
            </div>
            <div className="frow">
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" autoComplete="new-password" required value={form.password}
                  onChange={set('password')} placeholder="At least 8 characters" />
                {fieldErrors.password && <small style={{ color: 'var(--red)' }}>{fieldErrors.password}</small>}
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirm</label>
                <input id="confirm" type="password" autoComplete="new-password" required value={form.confirm}
                  onChange={set('confirm')} placeholder="Repeat it" />
                {fieldErrors.confirm && <small style={{ color: 'var(--red)' }}>{fieldErrors.confirm}</small>}
              </div>
            </div>

            {error && (
              <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 14px',
                borderRadius: 'var(--radius-sm)', fontSize: 13.5, marginBottom: 14 }}>{error}</div>
            )}

            <button className="cta-full" type="submit" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create account'}
            </button>
          </form>

          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14, textAlign: 'center' }}>
            Already have an account?{' '}
            <span style={{ color: 'var(--green)', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => router.push('/login')}>Sign in</span>
          </p>
        </div>
      </div>
    </>
  );
}
