import type { NextConfig } from 'next';

const API_URL = process.env.NEXT_PUBLIC_ABF_API_URL || 'http://localhost:3000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['shiki'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      { source: '/auth/:path*', destination: `${API_URL}/auth/:path*` },
    ];
  },
};

export default nextConfig;
