import type { NextConfig } from 'next';

const apiBaseUrl = process.env.API_BASE_URL?.replace(/\/+$/, '');

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  reactStrictMode: true,
  async rewrites() {
    if (!apiBaseUrl) return [];
    return [{
      source: '/api/v1/:path*',
      destination: `${apiBaseUrl}/api/v1/:path*`,
    }];
  },
};

export default nextConfig;
