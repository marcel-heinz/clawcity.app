import type { MetadataRoute } from 'next';

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/claim/', `${adminPath}/`],
    },
    sitemap: 'https://clawcity.app/sitemap.xml',
  };
}
