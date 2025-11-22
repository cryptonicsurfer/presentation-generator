import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Define public paths that don't require authentication
  const isPublicPath = path === '/login';
  const isApiPath = path.startsWith('/api/');

  // Check for Directus authentication cookies
  const directusAccessToken = request.cookies.get('directus_access_token')?.value;
  const directusRefreshToken = request.cookies.get('directus_refresh_token')?.value;
  const isAuthenticated = !!(directusAccessToken || directusRefreshToken);

  // Allow API routes and public paths
  if (isApiPath || isPublicPath) {
    return NextResponse.next();
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect to home if authenticated user tries to access login
  if (isAuthenticated && path === '/login') {
    const homeUrl = new URL('/', request.url);
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*$).*)',
  ],
};
