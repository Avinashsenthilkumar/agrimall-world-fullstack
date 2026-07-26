'use client';
import { useRouter } from 'next/navigation';
import LeafParticles from '../components/LeafParticles';
export default function RolePage(){
  const router=useRouter();
  return(
    <><LeafParticles/>
    <div className="role-screen">
      <div className="r-box">
        <div className="r-logo">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28"><path d="M12 22V12M12 12C12 7 8 4 4 4C4 9 7 12 12 12ZM12 12C12 7 16 4 20 4C20 9 17 12 12 12Z" stroke="#D4A24C" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          Agri Mall
        </div>
        <div className="r-tag">Global Plant Marketplace — Select Your Experience</div>
        <div className="r-cards">
          <div className="rc"><div className="ico">🛍️</div><h3>Customer</h3><p>Browse plants, view product details, checkout with payment gateway and track your live order.</p><button className="rb sol" onClick={()=>router.push('/customer')}>Shop Now →</button></div>
          <div className="rc"><div className="ico">🌴</div><h3>Regional Vendor</h3><p>Tamil Nadu nursery partner — view your orders, manage stock and track regional logistics.</p><button className="rb sol" onClick={()=>router.push('/vendor')}>Vendor Portal →</button></div>
          <div className="rc"><div className="ico">🛠️</div><h3>Admin</h3><p>Full platform access — logistics dashboard, all orders, global stock and nursery management.</p><button className="rb sol" onClick={()=>router.push('/admin')}>Admin Panel →</button></div>
          <div className="rc gold"><div className="ico">🪴</div><h3>Become a Seller</h3><p>Register your nursery with KYC, set up your store and start selling plants globally.</p><button className="rb sol" onClick={()=>router.push('/seller/onboard')}>New Seller — Register →</button><button className="rb out" onClick={()=>router.push('/seller/dashboard?login=1')}>Returning Seller — Sign In</button></div>
        </div>
        <p className="r-note">Demo — no real credentials required · All prices in ₹ INR</p>
      </div>
    </div></>
  );
}
