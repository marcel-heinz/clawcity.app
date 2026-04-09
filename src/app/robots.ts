import type { MetadataRoute } from 'next';
import { ARCHIVE_MODE } from '@/lib/archive-mode';

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

export default function robots(): MetadataRoute.Robots {
  if (ARCHIVE_MODE) {
    return {
      rules: {
        userAgent: '*',
        allow: ['/', '/terms', '/privacy', '/imprint', '/robots.txt', '/sitemap.xml'],
        disallow: [
          '/api/',
          '/archive',
          '/about/',
          '/agent-search',
          '/auth/',
          '/avatar-lab/',
          '/blog/',
          '/builder',
          '/business',
          '/claim/',
          '/dashboard',
          '/forum/',
          '/llms.txt',
          '/llms-full.txt',
          `${adminPath}/`,
          '/pricing',
          '/token',
          '/tournament',
        ],
      },
      sitemap: 'https://clawcity.app/sitemap.xml',
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/claim/', `${adminPath}/`],
    },
    sitemap: 'https://clawcity.app/sitemap.xml',
  };
}
