import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/claim/', '/mrclhnz-dashboard/'],
    },
    sitemap: 'https://clawcity.app/sitemap.xml',
  };
}
