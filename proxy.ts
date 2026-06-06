import { NextRequest, NextResponse } from 'next/server';

// Next.js 16 "proxy" (formerly middleware). Two jobs:
//  1. Redirect unauthenticated page loads to /login (UX gate, presence is fine).
//  2. Validate the Directus session SERVER-SIDE for the API routes that spend
//     money (Gemini/Claude). Previously every /api/* was let straight through
//     and only the UI was gated, so /api/generate etc. could be called by
//     anyone with curl and burn the keys.

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://cms.businessfalkenberg.se';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function accessTokenIsValid(token: string): Promise<boolean> {
  try {
    const r = await fetch(`${DIRECTUS_URL}/users/me?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

interface RefreshedTokens {
  access_token: string;
  refresh_token: string;
}

// Directus refresh tokens rotate (single-use). When we refresh to validate an
// expired session we must hand the new pair back to the browser, or the user
// gets silently logged out.
async function refreshSession(refreshToken: string): Promise<RefreshedTokens | null> {
  try {
    const r = await fetch(`${DIRECTUS_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, mode: 'json' }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const access_token = data?.data?.access_token;
    const refresh_token = data?.data?.refresh_token;
    if (!access_token || !refresh_token) return null;
    return { access_token, refresh_token };
  } catch {
    return null;
  }
}

function applyAuthCookies(res: NextResponse, tokens: RefreshedTokens): void {
  const secure = APP_URL.startsWith('https://');
  res.cookies.set('directus_access_token', tokens.access_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  });
  res.cookies.set('directus_refresh_token', tokens.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

async function guardApi(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get('directus_access_token')?.value;
  if (accessToken && (await accessTokenIsValid(accessToken))) {
    return NextResponse.next();
  }
  const refreshToken = request.cookies.get('directus_refresh_token')?.value;
  if (refreshToken) {
    const refreshed = await refreshSession(refreshToken);
    if (refreshed) {
      const res = NextResponse.next();
      applyAuthCookies(res, refreshed);
      return res;
    }
  }
  return NextResponse.json({ error: 'Unauthorized – please log in' }, { status: 401 });
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // API routes: gate everything except the auth flow itself.
  if (path.startsWith('/api/')) {
    if (path.startsWith('/api/auth/')) {
      return NextResponse.next();
    }
    return guardApi(request);
  }

  // Pages: redirect unauthenticated loads to /login (presence check is fine —
  // the security boundary is the API above).
  const isAuthenticated = !!(
    request.cookies.get('directus_access_token')?.value ||
    request.cookies.get('directus_refresh_token')?.value
  );

  if (path === '/login') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Pages (exclude static assets / files with an extension)…
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)',
    // …and all API routes, so the server-side auth gate above actually runs.
    '/api/:path*',
  ],
};
