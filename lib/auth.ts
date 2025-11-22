export const ALLOWED_DOMAINS = ["falkenberg.se", "ecoera.se"];

export interface DirectusTokenData {
  access_token: string;
  refresh_token: string;
  expires: number;
}

export interface DirectusAuthResponse {
  data: DirectusTokenData;
}

export interface AuthDetails {
  accessToken: string;
  refreshToken: string;
  expiryTimestamp: number;
}

const AUTH_STORAGE_KEY = 'directus_auth';
const TOKEN_EXPIRY_BUFFER_SECONDS = 60; // Refresh 60 seconds before expiry

/**
 * Login to Directus via proxy endpoint
 */
export async function loginToDirectus(
  email: string,
  password: string
): Promise<DirectusAuthResponse> {
  // Validate email domain
  const emailDomain = email.split('@')[1];
  if (!ALLOWED_DOMAINS.includes(emailDomain)) {
    throw new Error(`Email domain must be one of: ${ALLOWED_DOMAINS.join(', ')}`);
  }

  const response = await fetch('/api/auth/directus-proxy-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const responseData = await response.json();

  if (!response.ok) {
    const errorMessage = responseData.error || `Login failed with status: ${response.status}`;
    throw new Error(errorMessage);
  }

  if (responseData.data && responseData.data.access_token) {
    storeAuthDetails(responseData.data);
  }

  return responseData as DirectusAuthResponse;
}

/**
 * Refresh the access token
 */
export async function refreshAccessToken(): Promise<DirectusTokenData | null> {
  const response = await fetch('/api/auth/directus-proxy-refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 400) {
      removeToken();
    }
    return null;
  }

  const responseData = await response.json();

  if (responseData.data) {
    storeAuthDetails(responseData.data);
    return responseData.data as DirectusTokenData;
  }

  return null;
}

/**
 * Get access token with automatic refresh
 */
export async function getAccessToken(): Promise<string | null> {
  const authDetails = getAuthDetails();

  if (!authDetails) {
    return null;
  }

  const { expiryTimestamp, accessToken } = authDetails;
  const currentTime = Date.now();
  const bufferMilliseconds = TOKEN_EXPIRY_BUFFER_SECONDS * 1000;

  // Token still valid
  if (expiryTimestamp > currentTime + bufferMilliseconds) {
    return accessToken;
  }

  // Token expired or near expiry - refresh it
  const newTokensData = await refreshAccessToken();
  return newTokensData?.access_token || null;
}

/**
 * Store auth details in localStorage (for legacy support)
 */
export function storeAuthDetails(tokenData: DirectusTokenData): void {
  if (typeof window === 'undefined') return;

  const expiryTimestamp = Date.now() + (tokenData.expires || 3600000); // Default 1 hour
  const authDetails: AuthDetails = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiryTimestamp,
  };

  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authDetails));
  } catch (error) {
    console.error('Failed to store auth details:', error);
  }
}

/**
 * Get auth details from localStorage
 */
export function getAuthDetails(): AuthDetails | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;

    return JSON.parse(stored) as AuthDetails;
  } catch (error) {
    console.error('Failed to retrieve auth details:', error);
    return null;
  }
}

/**
 * Remove auth details from localStorage
 */
export function removeToken(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to remove auth details:', error);
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/check', {
      credentials: 'include',
    });
    const data = await response.json();
    return data.authenticated;
  } catch (error) {
    console.error('Failed to check authentication:', error);
    return false;
  }
}
