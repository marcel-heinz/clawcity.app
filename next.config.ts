import type { NextConfig } from "next";

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
    ],
  },
  async rewrites() {
    // If the admin path differs from the filesystem route, add a rewrite
    if (adminPath !== '/mrclhnz-dashboard') {
      return [
        {
          source: `${adminPath}`,
          destination: '/mrclhnz-dashboard',
        },
        {
          source: `${adminPath}/:path*`,
          destination: '/mrclhnz-dashboard/:path*',
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
