/**
 * API Client with JWT token management and automatic refresh.
 * Uses expo-secure-store for secure token persistence.
 */

import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'geoapp_token';
const REFRESH_TOKEN_KEY = 'geoapp_refresh_token';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export async function setTokens(
  token: string,
  refreshToken: string,
): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Internal: attempt to refresh an expired access token
// ---------------------------------------------------------------------------

let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  // Coalesce concurrent refresh calls so only one request is in-flight.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;

      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (data.token && data.refreshToken) {
        await setTokens(data.token, data.refreshToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

async function request<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;

  const makeRequest = async (): Promise<Response> => {
    const token = await getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options: RequestInit = { method, headers };
    if (body !== undefined && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options);
  };

  let res = await makeRequest();

  // On 401, try to refresh and retry once.
  if (res.status === 401) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      res = await makeRequest();
    }
  }

  let data: T;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = (await res.text()) as unknown as T;
  }

  if (!res.ok) {
    const errorMessage =
      (data as Record<string, unknown>)?.message ??
      (data as Record<string, unknown>)?.error ??
      `Request failed with status ${res.status}`;
    throw new ApiError(
      typeof errorMessage === 'string'
        ? errorMessage
        : `Request failed with status ${res.status}`,
      res.status,
      data,
    );
  }

  return { ok: true, status: res.status, data };
}

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// Public API object
// ---------------------------------------------------------------------------

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),

  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>('POST', path, body),

  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>('PUT', path, body),

  delete: <T = unknown>(path: string, body?: unknown) =>
    request<T>('DELETE', path, body),
} as const;
