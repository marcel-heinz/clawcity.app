export const ARCHIVE_MODE = process.env.NEXT_PUBLIC_ARCHIVE_MODE !== 'false';

export const ARCHIVE_PAGE_PATH = '/archive';

const LEGAL_PATHS = new Set(['/terms', '/privacy', '/imprint']);
const APP_ROUTE_FILE_PATHS = new Set(['/llms.txt', '/llms-full.txt']);
const PUBLIC_ASSET_PREFIXES = ['/_next', '/items/', '/sprites/'];

export function isArchiveLegalPath(pathname: string) {
  return LEGAL_PATHS.has(pathname);
}

export function isPublicAssetPath(pathname: string) {
  if (APP_ROUTE_FILE_PATHS.has(pathname)) {
    return false;
  }

  if (PUBLIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  if (pathname === '/favicon.ico' || pathname === '/site.webmanifest') {
    return true;
  }

  return /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|xml|json|webmanifest)$/i.test(pathname);
}
