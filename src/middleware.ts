import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ARCHIVE_MODE, ARCHIVE_PAGE_PATH, isArchiveLegalPath, isPublicAssetPath } from '@/lib/archive-mode';

const protectedRoutes = ['/builder', '/dashboard', '/billing'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAssetPath(pathname)) {
    return NextResponse.next();
  }

  if (ARCHIVE_MODE) {
    if (pathname === ARCHIVE_PAGE_PATH) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    if (pathname === '/') {
      return NextResponse.rewrite(new URL(ARCHIVE_PAGE_PATH, request.url));
    }

    if (isArchiveLegalPath(pathname)) {
      return NextResponse.next();
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          archived: true,
          error: 'ClawCity is archived. Live APIs are no longer available.',
        },
        { status: 410 }
      );
    }

    return NextResponse.redirect(new URL('/', request.url));
  }

  // Only protect specific routes
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));
  if (!isProtected) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/:path*'],
};
