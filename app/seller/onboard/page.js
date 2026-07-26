'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/AppContext';
import { KYC_STEPS } from '../../../lib/data';
import { launchConfetti } from '../../../components/Confetti';
import LeafParticles from '../../../components/LeafParticles';
import api from '../../../lib/api';

export default function SellerOnboard() {
  const router = useRouter();
  const { dispatch } = useApp();
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});
  const [uploads, setUploads] = useState({});
  const formRef = useRef();

  const pct = Math.round((step / KYC_STEPS.length) * 100);

  function collect() {
    if (!formRef.current) return {};
    const out = {};
    formRef.current.querySelectorAll('input,select,textarea').forEach(el => {
      if (el.id) out[el.id] = el.value;
    });
    return out;
  }

  function next() {
    const d = collect();
    if (step === 0) {
      if (!d.k0n?.trim()) { alert('Please enter your name.'); return; }
      if (!d.k0e?.includes('@')) { alert('Please enter a valid email.'); return; }
      if ((d.k0p||'').length < 6) { alert('Password must be at least 6 characters.'); return; }
      if (d.k0p !== d.k0p2) { alert('Passwords do not match.'); return; }
    }
    if (step === 1 && !d.k1n?.trim()) { alert('Please enter your nursery name.'); return; }
    if (step === 5) {
      const ag1 = formRef.current.querySelector('#ag1');
      const ag2 = formRef.current.querySelector('#ag2');
      if (!ag1?.checked || !ag2?.checked) { alert('Please accept both agreements to continue.'); return; }
    }
    setData(prev => ({ ...prev, ...d }));
    setStep(s => Math.min(s + 1, KYC_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    setStep(s => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function approve() {
    const payload = {
      email: data.k0e, pass: data.k0p, bizName: data.k1n || (data.k0n + ' Nursery'),
      ownerName: data.k0n, bizPhone: data.k1ph || '', bizState: data.k1st || 'India',
    };
    try {
      // Persist the seller to the real backend database.
      const saved = await api.register(payload);
      const seller = { ...payload, id: saved.id, listings: [], orders: [] };
      dispatch({ type: 'ADD_SELLER', seller });
      launchConfetti();
      setTimeout(() => {
        if (typeof window !== 'undefined') window.__sellerSession = seller;
        router.push('/seller/dashboard');
      }, 1100);
    } catch (err) {
      alert('Could not create account: ' + err.message + '\n(You can also sign in if you already registered.)');
    }
  }

  return (
    <>
      <LeafParticles />
      <div className="kyc-shell">
        <div className="kyc-tb">
          <div className="logo" style={{color:'#fff',fontFamily:"'Fraunces',serif",fontWeight:600}}>🌿 Agri Mall Seller Hub</div>
          <span style={{fontSize:'12.5px',opacity:.7,cursor:'pointer',color:'#fff',textDecoration:'underline'}} onClick={() => router.push('/')}>← Back to Roles</span>
        </div>

        <div className="kyc-body">
          <div className="kyc-inner">
            <div className="kprog"><div className="kpf" style={{width:`${pct}%`}} /></div>
            <div className="kstep">
              {KYC_STEPS.map((s, i) => (
                <div key={i} style={{display:'flex',alignItems:'center'}}>
                  {i > 0 && <div className={`sconn ${i <= step ? 'done' : ''}`} />}
                  <div className={`sdot ${i < step ? 'done' : i === step ? 'active' : ''}`}>
                    <div className="d">{i < step ? '✓' : i + 1}</div>
                    <div className="sl">{s}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{fontSize:'12px',color:'#8a7d6f',margin:'0 0 20px'}}>Step {step+1} of {KYC_STEPS.length} — {KYC_STEPS[step]}</p>
            <div ref={formRef}><StepContent step={step} data={data} uploads={uploads} setUploads={setUploads} onApprove={approve} /></div>
            {step < KYC_STEPS.length - 1 && (
              <div className="kact" style={{marginTop:'20px'}}>
                {step > 0 ? <button className="kback" onClick={back}>← Back</button> : <div />}
                <button className="knext" onClick={next}>
                  {step === KYC_STEPS.length - 2 ? 'Submit for Review →' : 'Continue →'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UploadBox({ id, label, icon, uploads, setUploads }) {
  return (
    <div style={{marginBottom:'14px'}}>
      <label style={{display:'block',fontSize:'11.5px',fontWeight:700,color:'#6b5e51',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:'5px'}}>{label}</label>
      <div className="upbox">
        <div className="uico">{icon}</div>
        <div className="ulbl">Tap to upload · JPG, PNG or PDF</div>
        <input type="file" accept="image/*,.pdf" onChange={() => setUploads(u => ({...u,[id]:true}))} />
      </div>
      {uploads[id] && <div className="udone show">✅ Document uploaded</div>}
    </div>
  );
}

function StepContent({ step, data, uploads, setUploads, onApprove }) {
  if (step === 0) return (
    <div className="kcard">
      <h2>Create Your Seller Account</h2>
      <div className="kdesc">Set your login email and password. Use these to sign back in any time.</div>
      <div className="field"><label>Your Name</label><input id="k0n" placeholder="Full name" defaultValue={data.k0n||''} /></div>
      <div className="field"><label>Email Address</label><input id="k0e" type="email" placeholder="you@nursery.com" defaultValue={data.k0e||''} /></div>
      <div className="field"><label>Create Password</label><input id="k0p" type="password" placeholder="Minimum 6 characters" /></div>
      <div className="field"><label>Confirm Password</label><input id="k0p2" type="password" placeholder="Repeat password" /></div>
      <div className="itip">🔐 Remember these credentials — use them to sign in as a <b>Returning Seller</b> from the role select screen later.</div>
    </div>
  );

  if (step === 1) return (
    <div className="kcard">
      <h2>Business Information</h2>
      <div className="kdesc">Tell buyers about your nursery.</div>
      <div className="field"><label>Business / Nursery Name</label><input id="k1n" placeholder="e.g. Green Roots Nursery" defaultValue={data.k1n||''} /></div>
      <div className="frow">
        <div className="field"><label>Owner Name</label><input id="k1o" placeholder="Full name" defaultValue={data.k1o||''} /></div>
        <div className="field"><label>Mobile</label><input id="k1ph" placeholder="+91 98xx xxxxxx" defaultValue={data.k1ph||''} /></div>
      </div>
      <div className="field"><label>State / Region</label>
        <select id="k1st" defaultValue={data.k1st||'Tamil Nadu'}>
          <option>Tamil Nadu</option><option>Kerala</option><option>Andhra Pradesh</option>
          <option>Karnataka</option><option>Maharashtra</option><option>Other</option>
        </select>
      </div>
      <div className="field"><label>Business Type</label>
        <select id="k1bt" defaultValue={data.k1bt||'Sole Proprietorship'}>
          <option>Sole Proprietorship</option><option>Partnership</option>
          <option>Private Limited</option><option>MSME Registered</option>
        </select>
      </div>
    </div>
  );

  if (step === 2) return (
    <div className="kcard">
      <h2>Identity Verification</h2>
      <div className="kdesc">Aadhaar & PAN — encrypted, reviewed only by our KYC team.</div>
      <div className="field"><label>Aadhaar Number</label><input id="k2a" maxLength={14} placeholder="xxxx xxxx xxxx" defaultValue={data.k2a||''} /></div>
      <UploadBox id="ua" label="Upload Aadhaar (Front)" icon="🪪" uploads={uploads} setUploads={setUploads} />
      <div className="field"><label>PAN Number</label><input id="k2p" maxLength={10} placeholder="ABCDE1234F" style={{textTransform:'uppercase'}} defaultValue={data.k2p||''} /></div>
      <UploadBox id="up" label="Upload PAN Card" icon="📄" uploads={uploads} setUploads={setUploads} />
    </div>
  );

  if (step === 3) return (
    <div className="kcard">
      <h2>GST & MSME</h2>
      <div className="kdesc">Tax credentials for marketplace compliance.</div>
      <div className="field"><label>GST Number (if applicable)</label><input id="k3g" placeholder="22AAAAA0000A1Z5" defaultValue={data.k3g||''} /></div>
      <UploadBox id="ug" label="Upload GST Certificate" icon="📋" uploads={uploads} setUploads={setUploads} />
      <div className="field"><label>MSME Udyam Number (optional)</label><input id="k3m" placeholder="UDYAM-TN-00-0000000" defaultValue={data.k3m||''} /></div>
      <div className="itip">💡 No GST yet? Sellers under ₹40L turnover may be exempt. Our team will guide you after approval.</div>
    </div>
  );

  if (step === 4) return (
    <div className="kcard">
      <h2>Bank Account Details</h2>
      <div className="kdesc">All payouts go directly to this account.</div>
      <div className="field"><label>Account Holder Name</label><input id="k4n" placeholder="As on passbook" defaultValue={data.k4n||''} /></div>
      <div className="field"><label>Bank Name</label><input id="k4b" placeholder="e.g. State Bank of India" defaultValue={data.k4b||''} /></div>
      <div className="frow">
        <div className="field"><label>Account Number</label><input id="k4a" placeholder="••••••••••" defaultValue={data.k4a||''} /></div>
        <div className="field"><label>IFSC Code</label><input id="k4i" placeholder="SBIN0001234" defaultValue={data.k4i||''} /></div>
      </div>
      <UploadBox id="ub" label="Upload Cancelled Cheque / Passbook" icon="🏦" uploads={uploads} setUploads={setUploads} />
    </div>
  );

  if (step === 5) return (
    <div className="kcard">
      <h2>Seller Agreement</h2>
      <div className="kdesc">Review and accept before going live.</div>
      <div style={{background:'var(--parchment)',borderRadius:'8px',padding:'14px',fontSize:'12.5px',color:'#5a4f43',lineHeight:'1.75',maxHeight:'180px',overflowY:'auto',WebkitOverflowScrolling:'touch',marginBottom:'14px',border:'1px solid var(--line)'}}>
        <b>Agri Mall Seller Terms</b><br/><br/>
        1. All listed plants must be legally shippable in your chosen regions.<br/>
        2. Maintain accurate stock and fulfil orders within 48 hours.<br/>
        3. Agri Mall charges an 8% transaction fee per sale.<br/>
        4. Payouts processed every 7 days to your registered bank account.<br/>
        5. Listings must include accurate photos, scientific names and care guides.<br/>
        6. Agri Mall may remove listings that violate quality or shipping standards.<br/>
        7. Sellers responsible for phytosanitary certificates for international shipments.<br/>
        8. Disputes resolved within 5 business days.
      </div>
      <div className="agrow"><input type="checkbox" id="ag1" /><label htmlFor="ag1">I have read and agree to the Agri Mall Seller Terms and Conditions.</label></div>
      <div className="agrow"><input type="checkbox" id="ag2" /><label htmlFor="ag2">I confirm all submitted documents are genuine and belong to my business.</label></div>
    </div>
  );

  if (step === 6) return (
    <div className="kcard">
      <div className="rev-state">
        <div className="rev-ico">📋</div>
        <h2 style={{color:'var(--forest)'}}>Application Submitted!</h2>
        <p style={{fontSize:'13.5px',color:'#8a7d6f',marginTop:'8px'}}>KYC under review. Typically approved within 24–48 hours.</p>
        <div className="rsteps">
          {['Account & login credentials saved','Business information verified','Identity documents received','GST / MSME records checked','Bank account confirmed'].map((s,i)=>(
            <div className="rstep" key={i}>✅ {s}</div>
          ))}
          <div className="rstep dim">⏳ Final approval pending</div>
        </div>
        <p style={{fontSize:'12px',color:'#8a7d6f',marginBottom:'14px'}}>This is a demo — click below to simulate instant approval.</p>
        <button className="appbtn" onClick={onApprove}>✅ Approve & Enter My Dashboard</button>
      </div>
    </div>
  );

  return null;
}
