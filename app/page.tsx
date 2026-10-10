// The role chooser — v1's landing screen, now aware of who is actually
// signed in. It reads the session from the server rather than offering a
// "pick your role" free-for-all: your role comes from your account.
'use client';

import { useRouter } from 'next/navigation';
import LeafParticles from '../components/LeafParticles';
import { useApp } from '../lib/client/AppContext';

export default function RolePage() {
  const router = useRouter();
  const { user, authLoading, logout } = useApp();

  const homeFor = (role: string) =>
    role === 'ADMIN' ? '/admin'
    : role === 'SELLER' ? '/seller/dashboard'
    : role === 'LOGISTICS' ? '/logistics'
    : '/customer';

  return (
    <>
      <LeafParticles />
      <div className="role-screen">
        <div className="r-box">
          <div className="r-logo">
            <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
              <path
                d="M12 22V12M12 12C12 7 8 4 4 4C4 9 7 12 12 12ZM12 12C12 7 16 4 20 4C20 9 17 12 12 12Z"
                stroke="#D4A24C"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            Agri Mall
          </div>
          <div className="r-tag">Global Plant Marketplace</div>

          {/* Signed in: go straight to where this account belongs. */}
          {!authLoading && user && (
            <div
              style={{
                background: 'var(--green-light)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                marginBottom: 22,
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Signed in as</div>
                <div style={{ fontWeight: 700, color: 'var(--forest)', fontSize: 16 }}>
                  {user.name || user.email}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                  {user.role.charAt(0) + user.role.slice(1).toLowerCase()} account
                  {user.role === 'SELLER' && user.sellerStatus
                    ? ` · ${user.sellerStatus.replace(/_/g, ' ').toLowerCase()}`
                    : ''}
                </div>
              </div>
              <button className="rb sol" style={{ width: 'auto' }} onClick={() => router.push(homeFor(user.role))}>
                Go to my dashboard →
              </button>
              <button
                className="rb out"
                style={{ width: 'auto' }}
                onClick={async () => {
                  await logout();
                  router.refresh();
                }}
              >
                Sign out
              </button>
            </div>
          )}

          <div className="r-cards">
            <div className="rc">
              <div className="ico">🛍️</div>
              <h3>Shop Plants</h3>
              <p>
                Browse verified nurseries, buy from several in one basket, and track each parcel
                separately.
              </p>
              <button className="rb sol" onClick={() => router.push('/customer')}>
                Browse the marketplace →
              </button>
            </div>

            <div className="rc">
              <div className="ico">🔑</div>
              <h3>Sign In</h3>
              <p>
                One sign-in for customers, sellers, logistics partners and staff — your account
                decides what you see.
              </p>
              <button className="rb sol" onClick={() => router.push('/login')}>
                Sign in →
              </button>
              <button className="rb out" onClick={() => router.push('/register')}>
                Create a customer account
              </button>
            </div>

            <div className="rc gold">
              <div className="ico">🪴</div>
              <h3>Sell on Agri Mall</h3>
              <p>
                Register your nursery, submit KYC and bank details, and start selling once our team
                has verified you.
              </p>
              <button className="rb sol" onClick={() => router.push('/seller/onboard')}>
                Become a seller →
              </button>
              <button className="rb out" onClick={() => router.push('/login')}>
                Existing seller — sign in
              </button>
            </div>
          </div>

          <p className="r-note">
            All prices in ₹ INR · Sellers are verified before they can list · Payments are confirmed
            server-side
          </p>
        </div>
      </div>
    </>
  );
}
