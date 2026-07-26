/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // better-sqlite3 is a native addon — keep it out of the webpack bundle.
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'loremflickr.com' },
    ],
  },
};
export default nextConfig;
