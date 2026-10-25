/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: Vercel Free, no server API (plan M11-01).
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
