/**
 * prisma/seed.ts — a realistic starting dataset.
 *
 *   npm run db:seed
 *
 * Creates: an admin, a logistics user, a customer, FOUR sellers in different
 * approval states, categories with differing commission rates, a catalogue
 * carried over from v1's plant data, inventory, and coupons.
 *
 * Deliberately included so the approval flow is visible from the first login:
 *   - Green Roots Nursery      APPROVED  (live, sellable)
 *   - Kerala Palm Growers      APPROVED  (live, sellable)
 *   - Chennai Coastal Nursery  PENDING_REVIEW (sits in the admin queue)
 *   - Nilgiri Exotics          DRAFT     (mid-registration)
 *
 * Passwords are bcrypt-hashed like any other account. They are printed at the
 * end for convenience; change them before any real deployment.
 */
// Load .env before anything touches process.env.
//
// This matters because `tsx` does NOT read .env on its own — only the Prisma
// CLI does. Without this, PrismaClient here throws
// "Environment variable not found: DATABASE_URL" even though .env is correct.
import 'dotenv/config';

import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'AgriMall#2026';
const rupees = (r: number) => Math.round(r * 100);

async function main() {
  console.log('\n🌱 Seeding AgriMall World…\n');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // -------------------------------------------------------------------------
  // Platform settings
  // -------------------------------------------------------------------------
  const settings: Array<[string, Prisma.InputJsonValue]> = [
    ['commission.defaultRate', 10],
    ['shipping.flatFeePerSeller', 14_900],
    ['shipping.freeAboveSubtotal', 200_000],
    ['returns.windowDays', 7],
    ['checkout.reservationTtlMinutes', 30],
  ];
  for (const [key, value] of settings) {
    await prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  console.log('  ✓ platform settings');

  // -------------------------------------------------------------------------
  // Staff and customer accounts
  // -------------------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: 'admin@agrimall.test' },
    create: {
      email: 'admin@agrimall.test',
      passwordHash,
      role: 'ADMIN',
      name: 'Platform Admin',
      emailVerifiedAt: new Date(),
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { email: 'logistics@agrimall.test' },
    create: {
      email: 'logistics@agrimall.test',
      passwordHash,
      role: 'LOGISTICS',
      name: 'Courier Operations',
      emailVerifiedAt: new Date(),
    },
    update: {},
  });

  const customerUser = await prisma.user.upsert({
    where: { email: 'anjali@example.test' },
    create: {
      email: 'anjali@example.test',
      phone: '9840011223',
      passwordHash,
      role: 'CUSTOMER',
      name: 'Anjali Menon',
      emailVerifiedAt: new Date(),
    },
    update: {},
  });

  const customer = await prisma.customer.upsert({
    where: { userId: customerUser.id },
    create: { userId: customerUser.id, fullName: 'Anjali Menon' },
    update: {},
  });
  await prisma.cart.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id }, update: {} });
  await prisma.wishlist.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id }, update: {} });

  const existingAddress = await prisma.address.findFirst({ where: { customerId: customer.id } });
  if (!existingAddress) {
    await prisma.address.create({
      data: {
        customerId: customer.id,
        label: 'Home',
        fullName: 'Anjali Menon',
        phone: '9840011223',
        line1: '14B Marine Drive, Ernakulam',
        city: 'Kochi',
        state: 'Kerala',
        pincode: '682031',
        country: 'India',
        isDefault: true,
      },
    });
  }
  console.log('  ✓ admin, logistics and customer accounts');

  // -------------------------------------------------------------------------
  // Categories — note the differing commission rates (§12)
  // -------------------------------------------------------------------------
  const categorySpecs = [
    { name: 'Indoor Plants', slug: 'indoor', commissionRate: 10, taxRate: 0, sortOrder: 1,
      imageUrl: 'https://images.unsplash.com/photo-1545241047-6083a3684587?w=600&q=70' },
    { name: 'Outdoor & Garden', slug: 'outdoor', commissionRate: 10, taxRate: 0, sortOrder: 2,
      imageUrl: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&q=70' },
    { name: 'Flowering Plants', slug: 'flowering', commissionRate: 12, taxRate: 0, sortOrder: 3,
      imageUrl: 'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=600&q=70' },
    // Saplings carry a lower commission — farmers' margins are thin.
    { name: 'Fruit Trees & Saplings', slug: 'fruit', commissionRate: 6, taxRate: 0, sortOrder: 4,
      imageUrl: 'https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?w=600&q=70' },
    { name: 'Succulents & Cacti', slug: 'succulent', commissionRate: 10, taxRate: 0, sortOrder: 5,
      imageUrl: 'https://images.unsplash.com/photo-1459156212016-c812468e2115?w=600&q=70' },
    // Premium exotics carry more.
    { name: 'Exotic & Rare', slug: 'exotic', commissionRate: 15, taxRate: 0, sortOrder: 6,
      imageUrl: 'https://images.unsplash.com/photo-1604762524889-3e2fcc145683?w=600&q=70' },
    // Tools are goods, not plants, so they attract GST.
    { name: 'Tools & Accessories', slug: 'tools', commissionRate: 12, taxRate: 18, sortOrder: 7,
      imageUrl: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&q=70' },
    { name: 'Seeds', slug: 'seeds', commissionRate: 8, taxRate: 5, sortOrder: 8,
      imageUrl: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=600&q=70' },
  ];

  const categories: Record<string, string> = {};
  for (const spec of categorySpecs) {
    const c = await prisma.category.upsert({
      where: { slug: spec.slug },
      create: spec,
      update: { commissionRate: spec.commissionRate, taxRate: spec.taxRate },
    });
    categories[spec.slug] = c.id;
  }
  console.log(`  ✓ ${categorySpecs.length} categories`);

  // -------------------------------------------------------------------------
  // Sellers, in four different approval states
  // -------------------------------------------------------------------------
  interface SellerSpec {
    email: string;
    businessName: string;
    slug: string;
    ownerName: string;
    phone: string;
    city: string;
    state: string;
    pincode: string;
    description: string;
    status: 'APPROVED' | 'PENDING_REVIEW' | 'DRAFT';
    commissionRate?: number;
    kyc?: { pan: string; gst?: string; aadhaarLast4?: string };
    bank?: { holder: string; last4: string; ifsc: string; bankName: string };
  }

  const sellerSpecs: SellerSpec[] = [
    {
      email: 'green@roots.test',
      businessName: 'Green Roots Nursery',
      slug: 'green-roots-nursery',
      ownerName: 'Karthik Selvam',
      phone: '9840011111',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pincode: '641012',
      description:
        'Family-run nursery near Coimbatore, growing curry leaf, jasmine and native saplings since 1984.',
      status: 'APPROVED',
      // Negotiated rate: beats the category rate for this seller.
      commissionRate: 8,
      kyc: { pan: 'ABCDE1234F', gst: '33ABCDE1234F1Z5', aadhaarLast4: '4821' },
      bank: { holder: 'Karthik Selvam', last4: '4412', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' },
    },
    {
      email: 'palms@kerala.test',
      businessName: 'Kerala Palm Growers',
      slug: 'kerala-palm-growers',
      ownerName: 'Deepa Raman',
      phone: '9847022222',
      city: 'Thrissur',
      state: 'Kerala',
      pincode: '680001',
      description:
        'Specialist palm and foliage nursery in Thrissur, supplying interior landscapers across South India.',
      status: 'APPROVED',
      kyc: { pan: 'FGHIJ5678K', gst: '32FGHIJ5678K1Z2', aadhaarLast4: '7733' },
      bank: { holder: 'Deepa Raman', last4: '8890', ifsc: 'SBIN0004567', bankName: 'State Bank of India' },
    },
    {
      // Sits in the admin approval queue, so the flow is visible immediately.
      email: 'coastal@chennai.test',
      businessName: 'Chennai Coastal Nursery',
      slug: 'chennai-coastal-nursery',
      ownerName: 'Vignesh Kumar',
      phone: '9840033333',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600041',
      description: 'Salt-tolerant coastal species and indoor succulents, grown on the ECR.',
      status: 'PENDING_REVIEW',
      kyc: { pan: 'LMNOP9012Q', gst: '33LMNOP9012Q1Z8', aadhaarLast4: '2290' },
      bank: { holder: 'Vignesh Kumar', last4: '1177', ifsc: 'ICIC0005678', bankName: 'ICICI Bank' },
    },
    {
      // Registered but hasn't submitted KYC — cannot sell.
      email: 'nilgiri@exotics.test',
      businessName: 'Nilgiri Exotics',
      slug: 'nilgiri-exotics',
      ownerName: 'Priya Subramaniam',
      phone: '9840044444',
      city: 'Ooty',
      state: 'Tamil Nadu',
      pincode: '643001',
      description: 'High-altitude exotic foliage from the Nilgiris.',
      status: 'DRAFT',
    },
  ];

  const sellers: Record<string, string> = {};

  for (const spec of sellerSpecs) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        email: spec.email,
        passwordHash,
        role: 'SELLER',
        name: spec.ownerName,
        emailVerifiedAt: new Date(),
      },
      update: {},
    });

    const seller = await prisma.seller.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        businessName: spec.businessName,
        slug: spec.slug,
        ownerName: spec.ownerName,
        businessEmail: spec.email,
        businessPhone: spec.phone,
        addressLine1: `${spec.businessName}, Main Road`,
        city: spec.city,
        state: spec.state,
        pincode: spec.pincode,
        country: 'India',
        description: spec.description,
        status: spec.status,
        commissionRate: spec.commissionRate ?? null,
        approvedAt: spec.status === 'APPROVED' ? new Date() : null,
        approvedById: spec.status === 'APPROVED' ? admin.id : null,
      },
      update: { status: spec.status },
    });
    sellers[spec.slug] = seller.id;

    const kycStatus =
      spec.status === 'APPROVED' ? 'APPROVED' : spec.status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'DRAFT';

    await prisma.sellerKyc.upsert({
      where: { sellerId: seller.id },
      create: {
        sellerId: seller.id,
        panNumber: spec.kyc?.pan ?? null,
        gstNumber: spec.kyc?.gst ?? null,
        // Only the last 4 digits are ever stored (§4).
        aadhaarLast4: spec.kyc?.aadhaarLast4 ?? null,
        panDocUrl: spec.kyc ? `kyc/${seller.id}/pan-sample.pdf` : null,
        addressDocUrl: spec.kyc ? `kyc/${seller.id}/address-sample.pdf` : null,
        verificationStatus: kycStatus,
        submittedAt: spec.kyc ? new Date() : null,
        reviewedAt: spec.status === 'APPROVED' ? new Date() : null,
        reviewedById: spec.status === 'APPROVED' ? admin.id : null,
      },
      update: { verificationStatus: kycStatus },
    });

    if (spec.bank) {
      await prisma.sellerBankAccount.upsert({
        where: { sellerId: seller.id },
        create: {
          sellerId: seller.id,
          accountHolderName: spec.bank.holder,
          accountLast4: spec.bank.last4,
          // A placeholder hash: the seed never handles a real account number.
          accountHash: `seed-${seller.id}`,
          ifsc: spec.bank.ifsc,
          bankName: spec.bank.bankName,
          isVerified: spec.status === 'APPROVED',
        },
        update: {},
      });
    }
  }
  console.log(`  ✓ ${sellerSpecs.length} sellers (2 approved, 1 pending review, 1 draft)`);

  // -------------------------------------------------------------------------
  // Catalogue — carried over from v1's plant data, now seller-owned
  // -------------------------------------------------------------------------
  interface ProductSpec {
    seller: string;
    category: string;
    name: string;
    latinName: string;
    sku: string;
    priceRupees: number;
    compareAtRupees?: number;
    stock: number;
    description: string;
    image: string;
    care: { light: string; water: string; temp: string; difficulty: string; safety: string };
    approved?: boolean;
  }

  const productSpecs: ProductSpec[] = [
    {
      seller: 'green-roots-nursery', category: 'indoor',
      name: "Snake Plant 'Laurentii'", latinName: 'Sansevieria trifasciata',
      sku: 'GRN-SNK-001', priceRupees: 849, compareAtRupees: 1099, stock: 48,
      description:
        'The ultimate beginner plant. Stiff, sword-like leaves edged in gold. Filters indoor air and thrives on neglect — forgiving of a fortnight without water.',
      image: 'https://images.unsplash.com/photo-1572688484438-313a6e50c333?w=800&q=75',
      care: { light: 'Low to bright indirect', water: 'Every 2–4 weeks', temp: '15–29°C', difficulty: 'Very Easy', safety: 'Mildly toxic to pets' },
    },
    {
      seller: 'green-roots-nursery', category: 'indoor',
      name: 'Curry Leaf Plant', latinName: 'Murraya koenigii',
      sku: 'GRN-CUR-002', priceRupees: 350, compareAtRupees: 450, stock: 65,
      description:
        'A kitchen essential grown from our own seed stock. Pick leaves fresh for thoran, sambar and rasam. Happiest in a sunny balcony pot.',
      image: 'https://images.unsplash.com/photo-1600411833196-7c1f6b1a8b90?w=800&q=75',
      care: { light: 'Full sun', water: 'Twice weekly', temp: '20–35°C', difficulty: 'Easy', safety: 'Edible — non-toxic' },
    },
    {
      seller: 'green-roots-nursery', category: 'flowering',
      name: 'Arabian Jasmine (Mallipoo)', latinName: 'Jasminum sambac',
      sku: 'GRN-JAS-003', priceRupees: 299, compareAtRupees: 399, stock: 72,
      description:
        'The mallipoo of Tamil Nadu — intensely fragrant white blooms through the warm months. Flowers best with morning sun and a weekly feed.',
      image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=800&q=75',
      care: { light: 'Full to partial sun', water: 'Every 2–3 days', temp: '18–35°C', difficulty: 'Easy', safety: 'Non-toxic' },
    },
    {
      seller: 'green-roots-nursery', category: 'fruit',
      name: 'Alphonso Mango Sapling (Grafted)', latinName: 'Mangifera indica',
      sku: 'GRN-MNG-004', priceRupees: 899, compareAtRupees: 1199, stock: 24,
      description:
        'Two-year grafted Alphonso on sturdy rootstock — fruits in 3–4 years rather than the decade a seedling takes. Supplied in a 10-inch grow bag.',
      image: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=800&q=75',
      care: { light: 'Full sun', water: 'Deep soak weekly', temp: '22–38°C', difficulty: 'Moderate', safety: 'Non-toxic' },
    },
    {
      seller: 'green-roots-nursery', category: 'tools',
      name: 'Digital Soil Moisture Meter', latinName: '',
      sku: 'GRN-TOOL-005', priceRupees: 899, stock: 40,
      description:
        'Push the probe in, read the dial. Removes the guesswork that kills more houseplants than any pest — overwatering.',
      image: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=75',
      care: { light: '', water: '', temp: '', difficulty: '', safety: '' },
    },
    {
      seller: 'kerala-palm-growers', category: 'indoor',
      name: 'Areca Palm', latinName: 'Dypsis lutescens',
      sku: 'KPG-ARE-001', priceRupees: 1199, compareAtRupees: 1599, stock: 35,
      description:
        'Feathery arching fronds that soften a room corner. One of the most effective natural humidifiers you can own. Grown in Thrissur shade houses.',
      image: 'https://images.unsplash.com/photo-1545165375-1b744b9ed444?w=800&q=75',
      care: { light: 'Bright indirect', water: 'Keep evenly moist', temp: '18–28°C', difficulty: 'Easy', safety: 'Pet safe' },
    },
    {
      seller: 'kerala-palm-growers', category: 'indoor',
      name: 'Elegant Peace Lily', latinName: 'Spathiphyllum wallisii',
      sku: 'KPG-PCL-002', priceRupees: 599, compareAtRupees: 799, stock: 54,
      description:
        'Graceful white spathes above deep green leaves. Tells you it is thirsty by drooping, then perks back up within hours of watering — the most communicative houseplant there is.',
      image: 'https://images.unsplash.com/photo-1593691509543-c55fb32d8de5?w=800&q=75',
      care: { light: 'Low to medium indirect', water: 'Weekly', temp: '18–27°C', difficulty: 'Easy', safety: 'Toxic to cats and dogs' },
    },
    {
      seller: 'kerala-palm-growers', category: 'exotic',
      name: 'Monstera Deliciosa', latinName: 'Monstera deliciosa',
      sku: 'KPG-MON-003', priceRupees: 1299, compareAtRupees: 2499, stock: 18,
      description:
        'The split-leaf icon. Mature fenestrated leaves on a well-rooted plant, not a cutting. Give it a moss pole and it will climb.',
      image: 'https://images.unsplash.com/photo-1614594975525-e45190c55d0b?w=800&q=75',
      care: { light: 'Bright indirect', water: 'When top 2 inches dry', temp: '18–30°C', difficulty: 'Moderate', safety: 'Toxic to pets' },
    },
    {
      seller: 'kerala-palm-growers', category: 'exotic',
      name: 'Fiddle Leaf Fig', latinName: 'Ficus lyrata',
      sku: 'KPG-FLF-004', priceRupees: 2499, compareAtRupees: 3200, stock: 12,
      description:
        'The statement plant for a bright corner. Large leathery violin-shaped leaves on a single trunk, around 4 feet on arrival. Dislikes being moved once settled.',
      image: 'https://images.unsplash.com/photo-1597055181300-e3633a207518?w=800&q=75',
      care: { light: 'Bright indirect, no harsh sun', water: 'Weekly when top 2" dry', temp: '18–24°C', difficulty: 'Fussy', safety: 'Toxic to pets' },
    },
    {
      seller: 'kerala-palm-growers', category: 'succulent',
      name: 'Jade Plant', latinName: 'Crassula ovata',
      sku: 'KPG-JAD-005', priceRupees: 349, compareAtRupees: 499, stock: 80,
      description:
        'Thick glossy coin-leaves on a woody trunk. Lives for decades, and the one plant that genuinely prefers you forget about it.',
      image: 'https://images.unsplash.com/photo-1509423350716-97f2360af2e4?w=800&q=75',
      care: { light: 'Bright direct', water: 'Every 2–3 weeks', temp: '15–30°C', difficulty: 'Very Easy', safety: 'Mildly toxic to pets' },
    },
    {
      seller: 'kerala-palm-growers', category: 'flowering',
      name: 'Tropical Hibiscus', latinName: 'Hibiscus rosa-sinensis',
      sku: 'KPG-HIB-006', priceRupees: 449, compareAtRupees: 599, stock: 60,
      description:
        'Dinner-plate blooms in deep red, produced continuously in warm weather. The temple flower of South India.',
      image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=800&q=75',
      care: { light: 'Full sun', water: 'Daily in summer', temp: '20–35°C', difficulty: 'Easy', safety: 'Non-toxic' },
    },
    {
      // Deliberately left awaiting approval, so the moderation queue is not
      // empty on first login.
      seller: 'kerala-palm-growers', category: 'exotic',
      name: 'Variegated Philodendron Pink Princess', latinName: 'Philodendron erubescens',
      sku: 'KPG-PPP-007', priceRupees: 4999, stock: 4,
      description:
        'Highly variegated pink-splashed leaves. A collector plant — each cutting is unique and variegation is never guaranteed on new growth.',
      image: 'https://images.unsplash.com/photo-1604762524889-3e2fcc145683?w=800&q=75',
      care: { light: 'Bright indirect', water: 'When top half dries', temp: '20–28°C', difficulty: 'Moderate', safety: 'Toxic to pets' },
      approved: false,
    },
  ];

  let productCount = 0;
  for (const spec of productSpecs) {
    const sellerId = sellers[spec.seller];
    const approved = spec.approved !== false;

    const existing = await prisma.product.findFirst({
      where: { sellerId, sku: spec.sku },
      select: { id: true },
    });
    if (existing) continue;

    const product = await prisma.product.create({
      data: {
        sellerId,
        categoryId: categories[spec.category],
        name: spec.name,
        slug: slugify(spec.name),
        latinName: spec.latinName || null,
        description: spec.description,
        sku: spec.sku,
        price: rupees(spec.priceRupees),
        compareAtPrice: spec.compareAtRupees ? rupees(spec.compareAtRupees) : null,
        status: approved ? 'ACTIVE' : 'PENDING_APPROVAL',
        approvalStatus: approved ? 'APPROVED' : 'PENDING',
        approvedAt: approved ? new Date() : null,
        approvedById: approved ? admin.id : null,
        careLight: spec.care.light || null,
        careWater: spec.care.water || null,
        careTemp: spec.care.temp || null,
        careDifficulty: spec.care.difficulty || null,
        careSafety: spec.care.safety || null,
        originLabel: sellerSpecs.find((s) => s.slug === spec.seller)?.state ?? null,
        weightGrams: 2000,
        images: { create: [{ url: spec.image, alt: spec.name, sortOrder: 0, isPrimary: true }] },
        inventory: { create: { onHand: spec.stock, reserved: 0, lowStockThreshold: 10 } },
      },
    });

    await prisma.inventoryMovement.create({
      data: {
        productId: product.id,
        sellerId,
        reason: 'SEED',
        delta: spec.stock,
        onHandAfter: spec.stock,
        reservedAfter: 0,
        refType: 'MANUAL',
        note: 'Opening stock from seed',
      },
    });
    productCount++;
  }
  console.log(`  ✓ ${productCount} products (1 awaiting moderation)`);

  // -------------------------------------------------------------------------
  // Coupons (§20)
  // -------------------------------------------------------------------------
  const now = new Date();
  const in60Days = new Date(now.getTime() + 60 * 86_400_000);

  const couponSpecs: Prisma.CouponCreateInput[] = [
    {
      code: 'GREEN10',
      scope: 'PLATFORM',
      description: '10% off your order, up to ₹300',
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscount: rupees(300),
      minOrderValue: rupees(999),
      startsAt: now,
      expiresAt: in60Days,
      perCustomerLimit: 1,
      usageLimit: 1000,
    },
    {
      code: 'FIRSTPLANT',
      scope: 'PLATFORM',
      description: '₹150 off your first order',
      discountType: 'FIXED',
      discountValue: rupees(150),
      minOrderValue: rupees(499),
      startsAt: now,
      expiresAt: in60Days,
      perCustomerLimit: 1,
    },
    {
      code: 'ROOTS20',
      scope: 'SELLER',
      description: '20% off everything from Green Roots Nursery',
      discountType: 'PERCENT',
      discountValue: 20,
      maxDiscount: rupees(500),
      minOrderValue: 0,
      seller: { connect: { id: sellers['green-roots-nursery'] } },
      startsAt: now,
      expiresAt: in60Days,
      perCustomerLimit: 2,
    },
    {
      code: 'SAPLING50',
      scope: 'CATEGORY',
      description: '₹50 off fruit trees and saplings',
      discountType: 'FIXED',
      discountValue: rupees(50),
      minOrderValue: rupees(500),
      category: { connect: { id: categories.fruit } },
      startsAt: now,
      expiresAt: in60Days,
      perCustomerLimit: 3,
    },
  ];

  for (const spec of couponSpecs) {
    await prisma.coupon.upsert({
      where: { code: spec.code },
      create: spec,
      update: { expiresAt: in60Days, isActive: true },
    });
  }
  console.log(`  ✓ ${couponSpecs.length} coupons`);

  // -------------------------------------------------------------------------
  console.log('\n─────────────────────────────────────────────────────');
  console.log('  Seed complete. Sign-in details:\n');
  console.log(`  Admin      admin@agrimall.test       / ${DEMO_PASSWORD}`);
  console.log(`  Logistics  logistics@agrimall.test   / ${DEMO_PASSWORD}`);
  console.log(`  Customer   anjali@example.test       / ${DEMO_PASSWORD}`);
  console.log(`  Seller A   green@roots.test          / ${DEMO_PASSWORD}   (approved, 8% commission)`);
  console.log(`  Seller B   palms@kerala.test         / ${DEMO_PASSWORD}   (approved)`);
  console.log(`  Seller C   coastal@chennai.test      / ${DEMO_PASSWORD}   (PENDING — try approving it)`);
  console.log(`  Seller D   nilgiri@exotics.test      / ${DEMO_PASSWORD}   (DRAFT — KYC incomplete)`);
  console.log('\n  Change these before deploying anywhere real.');
  console.log('─────────────────────────────────────────────────────\n');
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'plant'
  );
}

main()
  .catch((err) => {
    console.error('\n✗ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
