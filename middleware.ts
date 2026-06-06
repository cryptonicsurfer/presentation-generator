import { NextRequest, NextResponse } from 'next/server';

// Server-side auth gate for API routes.
//
// Background: the login flow stores the Directus session in httpOnly cookies
// (`directus_access_token` / `directus_refresh_token`, set by /api/auth/*).
// Same-origin fetches from the frontend send those cookies automatically, but
// nothing validated them server-side — so the LLM endpoints (/api/generate,
// /api/generate-yearplan, /api/tweak*, …) could be called by anyone with curl,
// burning the Gemini/Claude keys. This middleware validates the Directus
// session before any non-auth API route runs.

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

// Directus refresh tokens are single-use and rotate on every refresh, so we
// must capture the new pair and hand it back to the browser — otherwise the
// rotated token is lost and the user is silently logged out.
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

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized – please log in' },
    { status: 401 }
  );
}

export async function middleware(request: NextRequest) {
  // Let the auth flow itself through; gate everything else under /api.
  if (request.nextUrl.pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get('directus_access_token')?.value;
  if (accessToken && (await accessTokenIsValid(accessToken))) {
    return NextResponse.next();
  }

  // Access token missing/expired but a real session may still exist via the
  // refresh cookie. Refresh, propagate the rotated pair, and allow through.
  const refreshToken = request.cookies.get('directus_refresh_token')?.value;
  if (refreshToken) {
    const refreshed = await refreshSession(refreshToken);
    if (refreshed) {
      const res = NextResponse.next();
      applyAuthCookies(res, refreshed);
      return res;
    }
  }

  return unauthorized();
}

export const config = {
  // Only guard API routes. Pages remain client-gated by the AuthProvider.
  matcher: ['/api/:path*'],
};
