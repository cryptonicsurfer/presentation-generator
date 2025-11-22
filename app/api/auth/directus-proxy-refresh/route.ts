import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://cms.businessfalkenberg.se';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get('directus_refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'Refresh token not found' },
        { status: 401 }
      );
    }

    // Request new tokens from Directus
    const directusResponse = await fetch(`${DIRECTUS_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
        mode: 'json',
      }),
    });

    if (!directusResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to refresh token' },
        { status: directusResponse.status }
      );
    }

    const authData = await directusResponse.json();
    const { access_token, refresh_token: new_refresh_token, expires } = authData.data;

    if (!access_token || !new_refresh_token) {
      return NextResponse.json(
        { error: 'Invalid response from authentication server' },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: authData.data,
    });

    const secureFlag = APP_URL.startsWith('https://');

    // Update access token cookie
    response.cookies.set('directus_access_token', access_token, {
      httpOnly: true,
      secure: secureFlag,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600, // 1 hour
    });

    // Update refresh token cookie
    response.cookies.set('directus_refresh_token', new_refresh_token, {
      httpOnly: true,
      secure: secureFlag,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during token refresh' },
      { status: 500 }
    );
  }
}
