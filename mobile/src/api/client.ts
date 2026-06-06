/**
 * API Client with JWT token management and automatic refresh.
 * Uses expo-secure-store for secure token persistence.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const storage = {
  getItemAsync: (key: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(localStorage.getItem(key))
      : SecureStore.getItemAsync(key),
  setItemAsync: (key: string, value: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(void localStorage.setItem(key, value))
      : SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(void localStorage.removeItem(key))
      : SecureStore.deleteItemAsync(key),
};

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
  await storage.setItemAsync(TOKEN_KEY, token);
  await storage.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export async function getToken(): Promise<string | null> {
  return storage.getItemAsync(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return storage.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearTokens(): Promise<void> {
  await storage.deleteItemAsync(TOKEN_KEY);
  await storage.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Internal: attempt to refresh an expired access token
// ---------------------------------------------------------------------------

let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) {
        console.log('[Auth] No refresh token in storage');
        return false;
      }

      console.log('[Auth] Attempting token refresh...');
      const res = await fetch(`${BASE_URL}/auth/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        console.log('[Auth] Refresh failed:', res.status);
        return false;
      }

      const data = await res.json();
      if (data.token) {
        const newRefresh = data.refreshToken || refreshToken;
        await setTokens(data.token, newRefresh);
        console.log('[Auth] Token refreshed OK');
        return true;
      }
      return false;
    } catch (err: any) {
      console.log('[Auth] Refresh error:', err.message);
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
    } else {
      const hasRefresh = await getRefreshToken();
      if (hasRefresh) {
        throw new Error('Token refresh failed — network may be unavailable');
      }
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
