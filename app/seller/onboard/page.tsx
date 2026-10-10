// app/seller/onboard/page.tsx — §4, §26. The seller application.
//
// v1's KYC wizard looked right but did nothing real: documents never left the
// browser, and finishing the form made the seller `Active` immediately.
//
// This version walks the actual flow:
//
//   Account + business → register (status DRAFT, signed in)
//        ↓
//   KYC details        → POST /api/seller/kyc      (PAN/GST stored; Aadhaar last-4 only)
//        ↓
//   Bank details       → POST /api/seller/kyc/bank (account hashed, last-4 kept)
//        ↓
//   Documents          → POST /api/uploads         (written to real storage)
//        ↓
//   Submit             → status PENDING_REVIEW, admins notified
//        ↓
//   Admin approves     → status APPROVED, only then can they list
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeafParticles from '../../../components/LeafParticles';
import { launchConfetti } from '../../../components/Confetti';
import api from '../../../lib/client/api';
import { useApp, errorMessage, ApiClientError } from '../../../lib/client/AppContext';
import { toastError, toastSuccess } from '../../../components/Toast';

const STEPS = ['Account', 'Business', 'KYC', 'Bank', 'Documents', 'Review'] as const;

export default function SellerOnboardPage() {
  const router = useRouter();
  const { user, authLoading, refreshUser } = useApp();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Account + business
  const [account, setAccount] = useState({
    ownerName: '', email: '', password: '', confirm: '',
  });
  const [business, setBusiness] = useState({
    businessName: '', legalName: '', businessPhone: '',
    addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', description: '',
  });

  // KYC + bank
  const [kyc, setKyc] = useState({ panNumber: '', gstNumber: '', msmeNumber: '', aadhaarNumber: '' });
  const [bank, setBank] = useState({
    accountHolderName: '', accountNumber: '', confirmAccountNumber: '', ifsc: '', bankName: '', branch: '',
  });

  // Documents
  const [docs, setDocs] = useState<Record<string, { name: string; url: string }>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePolicy, setAgreePolicy] = useState(false);

  // An already-signed-in seller resumes where they left off.
  useEffect(() => {
    if (authLoading) return;
    if (user?.role === 'SELLER') {
      if (user.sellerStatus === 'APPROVED') {
        router.replace('/seller/dashboard');
        return;
      }
      if (user.sellerStatus === 'PENDING_REVIEW' || user.sellerStatus === 'UNDER_REVIEW') {
        setSubmitted(true);
        setStep(STEPS.length - 1);
        return;
      }
      // DRAFT: skip the account step, they already have one.
      void api.seller.profile().then((d) => {
        const s = d.seller as Record<string, unknown>;
        setBusiness({
          businessName: String(s.businessName ?? ''),
          legalName: String(s.legalName ?? ''),
          businessPhone: String(s.businessPhone ?? ''),
          addressLine1: String(s.addressLine1 ?? ''),
          addressLine2: String(s.addressLine2 ?? ''),
          city: String(s.city ?? ''),
          state: String(s.state ?? ''),
          pincode: String(s.pincode ?? ''),
          description: String(s.description ?? ''),
        });
        setStep(2);
      }).catch(() => setStep(2));
    } else if (user) {
      // Signed in as something else.
      setError(
        `You are signed in as a ${user.role.toLowerCase()} account. Please sign out before registering a nursery.`,
      );
    }
  }, [authLoading, user, router]);

  const alreadySeller = user?.role === 'SELLER';
  const pct = Math.round((step / (STEPS.length - 1)) * 100);

  function clearErrors() {
    setError(null);
    setFieldErrors({});
  }

  function applyFieldErrors(err: unknown) {
    if (err instanceof ApiClientError && err.fields) {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(err.fields)) flat[k] = v.join(' ');
      setFieldErrors(flat);
    }
    setError(errorMessage(err));
  }

  // ---- step 1 → create the account (DRAFT) -------------------------------
  async function createAccount() {
    clearErrors();
    if (account.password !== account.confirm) {
      setFieldErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    if (!agreeTerms || !agreePolicy) {
      setError('Please accept the seller agreement and platform policy.');
      return;
    }

    setBusy(true);
    try {
      await api.seller.register({
        ownerName: account.ownerName,
        email: account.email,
        password: account.password,
        businessName: business.businessName,
        legalName: business.legalName || undefined,
        businessPhone: business.businessPhone,
        addressLine1: business.addressLine1,
        addressLine2: business.addressLine2 || undefined,
        city: business.city,
        state: business.state,
        pincode: business.pincode,
        description: business.description || undefined,
        acceptedTerms: true,
        acceptedPolicy: true,
      });
      await refreshUser();
      toastSuccess('Your seller account is created. Now complete your KYC.');
      setStep(2);
    } catch (err) {
      applyFieldErrors(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveKyc() {
    clearErrors();
    setBusy(true);
    try {
      await api.seller.saveKyc({
        panNumber: kyc.panNumber,
        gstNumber: kyc.gstNumber || '',
        msmeNumber: kyc.msmeNumber || '',
        aadhaarNumber: kyc.aadhaarNumber || '',
      });
      toastSuccess('KYC details saved');
      setStep(3);
    } catch (err) {
      applyFieldErrors(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveBank() {
    clearErrors();
    setBusy(true);
    try {
      await api.seller.saveBank(bank);
      toastSuccess('Bank details saved');
      setStep(4);
    } catch (err) {
      applyFieldErrors(err);
    } finally {
      setBusy(false);
    }
  }

  async function uploadDoc(field: string, file: File) {
    setUploading(field);
    clearErrors();
    try {
      const res = await api.upload(file, 'KYC_DOCUMENT', field);
      setDocs((d) => ({ ...d, [field]: { name: file.name, url: res.file.url } }));
      toastSuccess(`${file.name} uploaded`);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  async function submitApplication() {
    clearErrors();
    setBusy(true);
    try {
      await api.seller.submitApplication();
      await refreshUser();
      launchConfetti();
      setSubmitted(true);
      setStep(STEPS.length - 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LeafParticles />
      <div className="kyc-shell">
        <div className="kyc-tb">
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 19, color: 'var(--forest)' }}>
            🌿 Agri Mall · Seller registration
          </div>
          <button className="btn btn-outline" style={{ padding: '6px 13px', fontSize: 12.5 }}
            onClick={() => router.push('/')}>
            Exit
          </button>
        </div>

        <div className="kyc-body">
          <div className="kyc-inner">
            {/* Progress */}
            <div className="kprog">
              {STEPS.map((label, i) => (
                <div key={label} className={`kstep ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
                  <span>{i < step ? '✓' : i + 1}</span>
                  {label}
                </div>
              ))}
            </div>
            <div className="prog-bar" style={{ marginBottom: 26 }}>
              <div className="prog-bar-fill" style={{ width: `${pct}%` }} />
            </div>

            {error && (
              <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '12px 15px',
                borderRadius: 'var(--radius-sm)', fontSize: 13.5, marginBottom: 18, lineHeight: 1.55 }}>
                {error}
              </div>
            )}

            {/* ---------- STEP 0: account ---------- */}
            {step === 0 && !alreadySeller && (
              <div className="kcard">
                <h2>Create your seller account</h2>
                <p className="kdesc">
                  This is the account you will use to sign in and manage your nursery.
                </p>

                <div className="field">
                  <label>Your name</label>
                  <input value={account.ownerName}
                    onChange={(e) => setAccount({ ...account, ownerName: e.target.value })}
                    placeholder="e.g. Karthik Selvam" />
                  {fieldErrors.ownerName && <small style={{ color: 'var(--red)' }}>{fieldErrors.ownerName}</small>}
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={account.email}
                    onChange={(e) => setAccount({ ...account, email: e.target.value })}
                    placeholder="you@nursery.com" />
                  {fieldErrors.email && <small style={{ color: 'var(--red)' }}>{fieldErrors.email}</small>}
                </div>
                <div className="frow">
                  <div className="field">
                    <label>Password</label>
                    <input type="password" value={account.password}
                      onChange={(e) => setAccount({ ...account, password: e.target.value })}
                      placeholder="At least 8 characters, with a number" />
                    {fieldErrors.password && <small style={{ color: 'var(--red)' }}>{fieldErrors.password}</small>}
                  </div>
                  <div className="field">
                    <label>Confirm password</label>
                    <input type="password" value={account.confirm}
                      onChange={(e) => setAccount({ ...account, confirm: e.target.value })} />
                    {fieldErrors.confirm && <small style={{ color: 'var(--red)' }}>{fieldErrors.confirm}</small>}
                  </div>
                </div>

                <div className="kact">
                  <span />
                  <button className="knext" onClick={() => { clearErrors(); setStep(1); }}
                    disabled={!account.ownerName || !account.email || !account.password}>
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* ---------- STEP 1: business ---------- */}
            {step === 1 && (
              <div className="kcard">
                <h2>About your nursery</h2>
                <p className="kdesc">This is what customers will see on your storefront.</p>

                <div className="field">
                  <label>Nursery / business name</label>
                  <input value={business.businessName}
                    onChange={(e) => setBusiness({ ...business, businessName: e.target.value })}
                    placeholder="e.g. Green Roots Nursery" />
                  {fieldErrors.businessName && <small style={{ color: 'var(--red)' }}>{fieldErrors.businessName}</small>}
                </div>
                <div className="frow">
                  <div className="field">
                    <label>Registered legal name <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                    <input value={business.legalName}
                      onChange={(e) => setBusiness({ ...business, legalName: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Business phone</label>
                    <input inputMode="numeric" value={business.businessPhone}
                      onChange={(e) => setBusiness({ ...business, businessPhone: e.target.value })}
                      placeholder="98400 11111" />
                    {fieldErrors.businessPhone && <small style={{ color: 'var(--red)' }}>{fieldErrors.businessPhone}</small>}
                  </div>
                </div>
                <div className="field">
                  <label>Address</label>
                  <input value={business.addressLine1}
                    onChange={(e) => setBusiness({ ...business, addressLine1: e.target.value })}
                    placeholder="Street, area" />
                  {fieldErrors.addressLine1 && <small style={{ color: 'var(--red)' }}>{fieldErrors.addressLine1}</small>}
                </div>
                <div className="frow">
                  <div className="field">
                    <label>City</label>
                    <input value={business.city}
                      onChange={(e) => setBusiness({ ...business, city: e.target.value })} placeholder="Coimbatore" />
                    {fieldErrors.city && <small style={{ color: 'var(--red)' }}>{fieldErrors.city}</small>}
                  </div>
                  <div className="field">
                    <label>State</label>
                    <input value={business.state}
                      onChange={(e) => setBusiness({ ...business, state: e.target.value })} placeholder="Tamil Nadu" />
                    {fieldErrors.state && <small style={{ color: 'var(--red)' }}>{fieldErrors.state}</small>}
                  </div>
                  <div className="field">
                    <label>PIN code</label>
                    <input inputMode="numeric" maxLength={6} value={business.pincode}
                      onChange={(e) => setBusiness({ ...business, pincode: e.target.value })} placeholder="641012" />
                    {fieldErrors.pincode && <small style={{ color: 'var(--red)' }}>{fieldErrors.pincode}</small>}
                  </div>
                </div>
                <div className="field">
                  <label>Tell customers about your nursery</label>
                  <textarea rows={3} value={business.description}
                    onChange={(e) => setBusiness({ ...business, description: e.target.value })}
                    placeholder="e.g. Family-run nursery growing native saplings since 1984."
                    style={{ width: '100%', padding: '11px 13px', border: '1.5px solid var(--border)',
                      borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }} />
                </div>

                {!alreadySeller && (
                  <div style={{ background: 'var(--cream)', borderRadius: 'var(--radius-sm)',
                    padding: '14px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.6 }}>
                    <label style={{ display: 'flex', gap: 9, cursor: 'pointer', marginBottom: 9 }}>
                      <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                      <span>
                        I accept the Agri Mall seller agreement, including the platform commission
                        deducted from each sale.
                      </span>
                    </label>
                    <label style={{ display: 'flex', gap: 9, cursor: 'pointer' }}>
                      <input type="checkbox" checked={agreePolicy} onChange={(e) => setAgreePolicy(e.target.checked)} />
                      <span>
                        I confirm the details I provide are accurate, and understand my account will be
                        reviewed before I can list products.
                      </span>
                    </label>
                  </div>
                )}

                <div className="kact">
                  {!alreadySeller ? (
                    <>
                      <button className="kback" onClick={() => setStep(0)}>← Back</button>
                      <button className="knext" onClick={createAccount} disabled={busy}>
                        {busy ? 'Creating your account…' : 'Create account →'}
                      </button>
                    </>
                  ) : (
                    <>
                      <span />
                      <button className="knext" onClick={() => setStep(2)}>Continue →</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ---------- STEP 2: KYC ---------- */}
            {step === 2 && (
              <div className="kcard">
                <h2>Identity &amp; tax details</h2>
                <p className="kdesc">
                  We verify every seller before they can sell. These details are stored securely and
                  are visible only to you and our verification team.
                </p>

                <div className="field">
                  <label>PAN number</label>
                  <input value={kyc.panNumber} maxLength={10}
                    onChange={(e) => setKyc({ ...kyc, panNumber: e.target.value.toUpperCase() })}
                    placeholder="ABCDE1234F" style={{ fontFamily: 'monospace', letterSpacing: 1 }} />
                  {fieldErrors.panNumber && <small style={{ color: 'var(--red)' }}>{fieldErrors.panNumber}</small>}
                </div>
                <div className="frow">
                  <div className="field">
                    <label>GSTIN <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(if registered)</span></label>
                    <input value={kyc.gstNumber} maxLength={15}
                      onChange={(e) => setKyc({ ...kyc, gstNumber: e.target.value.toUpperCase() })}
                      placeholder="33ABCDE1234F1Z5" style={{ fontFamily: 'monospace' }} />
                    {fieldErrors.gstNumber && <small style={{ color: 'var(--red)' }}>{fieldErrors.gstNumber}</small>}
                  </div>
                  <div className="field">
                    <label>MSME / Udyam <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                    <input value={kyc.msmeNumber}
                      onChange={(e) => setKyc({ ...kyc, msmeNumber: e.target.value.toUpperCase() })}
                      placeholder="UDYAM-TN-00-0000000" />
                  </div>
                </div>
                <div className="field">
                  <label>Aadhaar number <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                  <input inputMode="numeric" maxLength={12} value={kyc.aadhaarNumber}
                    onChange={(e) => setKyc({ ...kyc, aadhaarNumber: e.target.value.replace(/\D/g, '') })}
                    placeholder="12 digits" style={{ fontFamily: 'monospace', letterSpacing: 1 }} />
                  {fieldErrors.aadhaarNumber && <small style={{ color: 'var(--red)' }}>{fieldErrors.aadhaarNumber}</small>}
                  <small style={{ color: 'var(--text-muted)' }}>
                    We store only the last 4 digits plus a one-way check value. The full number is
                    never saved.
                  </small>
                </div>

                <div className="kact">
                  <button className="kback" onClick={() => setStep(alreadySeller ? 1 : 1)}>← Back</button>
                  <button className="knext" onClick={saveKyc} disabled={busy || !kyc.panNumber}>
                    {busy ? 'Saving…' : 'Save &amp; continue →'}
                  </button>
                </div>
              </div>
            )}

            {/* ---------- STEP 3: bank ---------- */}
            {step === 3 && (
              <div className="kcard">
                <h2>Where should we send your payouts?</h2>
                <p className="kdesc">
                  Your earnings, after platform commission, are transferred to this account once each
                  delivered parcel clears its return window.
                </p>

                <div className="field">
                  <label>Account holder name</label>
                  <input value={bank.accountHolderName}
                    onChange={(e) => setBank({ ...bank, accountHolderName: e.target.value })}
                    placeholder="As printed on your passbook" />
                  {fieldErrors.accountHolderName && <small style={{ color: 'var(--red)' }}>{fieldErrors.accountHolderName}</small>}
                </div>
                <div className="frow">
                  <div className="field">
                    <label>Account number</label>
                    <input inputMode="numeric" value={bank.accountNumber}
                      onChange={(e) => setBank({ ...bank, accountNumber: e.target.value.replace(/\D/g, '') })}
                      placeholder="9 to 18 digits" style={{ fontFamily: 'monospace' }} />
                    {fieldErrors.accountNumber && <small style={{ color: 'var(--red)' }}>{fieldErrors.accountNumber}</small>}
                  </div>
                  <div className="field">
                    <label>Confirm account number</label>
                    <input inputMode="numeric" value={bank.confirmAccountNumber}
                      onChange={(e) => setBank({ ...bank, confirmAccountNumber: e.target.value.replace(/\D/g, '') })}
                      style={{ fontFamily: 'monospace' }} />
                    {fieldErrors.confirmAccountNumber && <small style={{ color: 'var(--red)' }}>{fieldErrors.confirmAccountNumber}</small>}
                  </div>
                </div>
                <div className="frow">
                  <div className="field">
                    <label>IFSC code</label>
                    <input value={bank.ifsc} maxLength={11}
                      onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })}
                      placeholder="HDFC0001234" style={{ fontFamily: 'monospace' }} />
                    {fieldErrors.ifsc && <small style={{ color: 'var(--red)' }}>{fieldErrors.ifsc}</small>}
                  </div>
                  <div className="field">
                    <label>Bank name <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                    <input value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
                  </div>
                </div>

                <div style={{ background: 'var(--green-light)', borderRadius: 'var(--radius-sm)',
                  padding: '11px 14px', fontSize: 12.5, marginBottom: 16, lineHeight: 1.55 }}>
                  🔒 We keep only the last 4 digits of your account number in readable form. The full
                  number is stored as a one-way hash and cannot be read back by anyone, including us.
                </div>

                <div className="kact">
                  <button className="kback" onClick={() => setStep(2)}>← Back</button>
                  <button className="knext" onClick={saveBank} disabled={busy || !bank.accountNumber || !bank.ifsc}>
                    {busy ? 'Saving…' : 'Save &amp; continue →'}
                  </button>
                </div>
              </div>
            )}

            {/* ---------- STEP 4: documents ---------- */}
            {step === 4 && (
              <div className="kcard">
                <h2>Upload your documents</h2>
                <p className="kdesc">
                  JPG, PNG or PDF, up to 8MB each. These are stored privately and are not served as
                  public files.
                </p>

                {([
                  ['panDocUrl', 'PAN card', true],
                  ['addressDocUrl', 'Business address proof', false],
                  ['gstDocUrl', 'GST certificate', false],
                  ['bankDocUrl', 'Cancelled cheque or passbook', false],
                ] as Array<[string, string, boolean]>).map(([field, label, required]) => (
                  <div key={field} className="upbox" style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div className="uico">{docs[field] ? '✓' : '📄'}</div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div className="ulbl">
                          {label}
                          {required && <span style={{ color: 'var(--red)' }}> *</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {docs[field] ? docs[field].name : 'No file chosen yet'}
                        </div>
                      </div>
                      <label className="btn btn-outline" style={{ cursor: 'pointer', fontSize: 12.5, padding: '6px 13px' }}>
                        {uploading === field ? 'Uploading…' : docs[field] ? 'Replace' : 'Choose file'}
                        <input type="file" accept="image/jpeg,image/png,application/pdf" hidden
                          disabled={uploading !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadDoc(field, file);
                            e.target.value = '';
                          }} />
                      </label>
                    </div>
                  </div>
                ))}

                <div className="kact">
                  <button className="kback" onClick={() => setStep(3)}>← Back</button>
                  <button className="knext" onClick={() => setStep(5)} disabled={!docs.panDocUrl}>
                    {docs.panDocUrl ? 'Continue →' : 'Upload your PAN to continue'}
                  </button>
                </div>
              </div>
            )}

            {/* ---------- STEP 5: review / submitted ---------- */}
            {step === 5 && (
              <div className="kcard">
                {submitted ? (
                  <div style={{ textAlign: 'center', padding: '14px 0' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <h2 style={{ marginBottom: 8 }}>Application submitted</h2>
                    <p className="kdesc" style={{ maxWidth: 440, margin: '0 auto 20px' }}>
                      Thank you. Our verification team will review your KYC documents and bank details.
                      You can sign in at any time to check your status — <strong>you will be able to list
                      products once your account is approved</strong>.
                    </p>
                    <div style={{ background: 'var(--cream)', borderRadius: 'var(--radius-sm)',
                      padding: '14px 18px', fontSize: 13, textAlign: 'left', maxWidth: 420,
                      margin: '0 auto 20px', lineHeight: 1.7 }}>
                      <strong>What happens next</strong>
                      <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--text-mid)' }}>
                        <li>Our team reviews your documents</li>
                        <li>Your account becomes approved (or we tell you what to correct)</li>
                        <li>You add your plants — each listing is checked before it goes live</li>
                        <li>Orders arrive, you pack and dispatch, and payouts follow delivery</li>
                      </ol>
                    </div>
                    <button className="btn btn-forest" onClick={() => router.push('/seller/dashboard')}>
                      Go to my dashboard →
                    </button>
                  </div>
                ) : (
                  <>
                    <h2>Review and submit</h2>
                    <p className="kdesc">
                      Check everything over. Once submitted, your application goes to our verification
                      team.
                    </p>

                    <ReviewSummary />

                    <div className="kact">
                      <button className="kback" onClick={() => setStep(4)}>← Back</button>
                      <button className="knext" onClick={submitApplication} disabled={busy}>
                        {busy ? 'Submitting…' : 'Submit application'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Reads the saved application back from the server, so the review step shows
 *  what is actually stored rather than what is still in local state. */
function ReviewSummary() {
  const [seller, setSeller] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.seller
      .profile()
      .then((d) => setSeller(d.seller))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <div style={{ color: 'var(--red)', fontSize: 13.5 }}>{error}</div>;
  if (!seller) {
    return (
      <div style={{ textAlign: 'center', padding: 26, color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 10px' }} />Loading your application…
      </div>
    );
  }

  const kyc = (seller.kyc ?? {}) as Record<string, unknown>;
  const bank = (seller.bankAccount ?? {}) as Record<string, unknown>;
  const documents = (kyc.documents ?? {}) as Record<string, boolean>;

  const rows: Array<[string, string]> = [
    ['Nursery', String(seller.businessName ?? '—')],
    ['Owner', String(seller.ownerName ?? '—')],
    ['Email', String(seller.businessEmail ?? '—')],
    ['Phone', String(seller.businessPhone ?? '—')],
    ['Address', [seller.addressLine1, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ') || '—'],
    ['PAN', String(kyc.panNumber ?? '— not provided')],
    ['GSTIN', String(kyc.gstNumber ?? '— not provided')],
    ['Aadhaar', kyc.aadhaarLast4 ? `•••• •••• ${String(kyc.aadhaarLast4)}` : '— not provided'],
    ['Bank account', bank.accountLast4 ? `•••••• ${String(bank.accountLast4)} · ${String(bank.ifsc ?? '')}` : '— not provided'],
    ['Account holder', String(bank.accountHolderName ?? '—')],
  ];

  return (
    <>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
        overflow: 'hidden', marginBottom: 16 }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{ display: 'flex', gap: 12, padding: '10px 14px', fontSize: 13,
            background: i % 2 ? 'var(--cream)' : '#fff' }}>
            <span style={{ width: 130, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, marginBottom: 16 }}>
        <strong style={{ display: 'block', marginBottom: 7 }}>Documents on file</strong>
        {([['pan', 'PAN card'], ['address', 'Address proof'], ['gst', 'GST certificate'],
           ['bank', 'Bank proof']] as Array<[string, string]>).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4,
            color: documents[key] ? 'var(--green)' : 'var(--text-muted)' }}>
            <span>{documents[key] ? '✓' : '○'}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
