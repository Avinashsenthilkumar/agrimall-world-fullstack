'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import api from '../../lib/client/api';
import { errorMessage } from '../../lib/client/AppContext';

export default function VerifyEmailPage() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState('failed'); setError('This page needs the link from your verification email.'); return; }
    void api.auth
      .verifyEmail(token)
      .then(() => setState('done'))
      .catch((err) => { setError(errorMessage(err)); setState('failed'); });
  }, [token]);

  return (
    <>
      <LeafParticles />
      <div className="role-screen">
        <div className="r-box" style={{ maxWidth: 420 }}>
          <div className="r-logo" style={{ justifyContent: 'center' }}>🌿 Agri Mall</div>
          {state === 'working' && (
            <>
              <div className="r-tag">Verifying your email…</div>
              <div className="spinner" style={{ margin: '20px auto' }} />
            </>
          )}
          {state === 'done' && (
            <>
              <div className="r-tag">Email verified ✓</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 18 }}>
                Thank you — your email address is confirmed.
              </p>
              <button className="cta-full" onClick={() => router.push('/customer')}>Start shopping →</button>
            </>
          )}
          {state === 'failed' && (
            <>
              <div className="r-tag">We could not verify that link</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 18 }}>{error}</p>
              <button className="cta-full" onClick={() => router.push('/login')}>Back to sign in</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
