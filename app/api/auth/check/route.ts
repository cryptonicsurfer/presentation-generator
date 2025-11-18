import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const directusAccessToken = request.cookies.get('directus_access_token')?.value;
  const directusRefreshToken = request.cookies.get('directus_refresh_token')?.value;
  const isAuthenticated = !!(directusAccessToken || directusRefreshToken);

  return NextResponse.json({
    authenticated: isAuthenticated,
    hasAccessToken: !!directusAccessToken,
    hasRefreshToken: !!directusRefreshToken,
  });
}
