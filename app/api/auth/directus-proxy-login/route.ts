import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://cms.businessfalkenberg.se';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Forward credentials to Directus
    const directusResponse = await fetch(`${DIRECTUS_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        mode: 'json',
      }),
    });

    if (!directusResponse.ok) {
      const errorData = await directusResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.errors?.[0]?.message || 'Login failed' },
        { status: directusResponse.status }
      );
    }

    const authData = await directusResponse.json();
    const { access_token, refresh_token, expires } = authData.data;

    if (!access_token || !refresh_token) {
      return NextResponse.json(
        { error: 'Invalid response from authentication server' },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: authData.data,
    });

    // Set access token cookie (1 hour)
    response.cookies.set('directus_access_token', access_token, {
      httpOnly: true,
      secure: APP_URL.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 3600, // 1 hour
    });

    // Set refresh token cookie (30 days)
    response.cookies.set('directus_refresh_token', refresh_token, {
      httpOnly: true,
      secure: APP_URL.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during login' },
      { status: 500 }
    );
  }
}
