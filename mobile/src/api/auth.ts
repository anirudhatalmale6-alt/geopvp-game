/**
 * Auth API functions.
 * All functions use the shared API client which handles JWT and token refresh.
 */

import { api, setTokens } from './client';
import { getDeviceId } from '../utils/device';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  username: string;
  email: string;
  waiverAcceptedAt?: string | null;
}

interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

interface MessageResponse {
  message: string;
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export async function signup(
  username: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const deviceId = await getDeviceId();
  const { data } = await api.post<AuthResponse>('/auth/signup', {
    username,
    email,
    password,
    deviceId,
  });
  if (data.token && data.refreshToken) {
    await setTokens(data.token, data.refreshToken);
  }
  return data;
}

export async function verifyEmail(
  email: string,
  code: string,
): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/verify-email', {
    email,
    code,
  });
  return data;
}

export async function resendCode(email: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/resend-code', {
    email,
  });
  return data;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const deviceId = await getDeviceId();
  const { data } = await api.post<AuthResponse>('/auth/login', {
    email,
    password,
    deviceId,
  });
  if (data.token && data.refreshToken) {
    await setTokens(data.token, data.refreshToken);
  }
  return data;
}

export async function forgotPassword(
  email: string,
): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/forgot-password', {
    email,
  });
  return data;
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/reset-password', {
    email,
    code,
    newPassword,
  });
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return data;
}

export async function getProfile(): Promise<User> {
  const { data } = await api.get<{ user: User }>('/auth/profile');
  return data.user;
}

export async function updateProfile(
  updates: Partial<Pick<User, 'username' | 'email'>>,
): Promise<User> {
  const { data } = await api.put<User>('/auth/profile', updates);
  return data;
}

export async function deleteAccount(
  confirmation: string,
): Promise<MessageResponse> {
  const { data } = await api.delete<MessageResponse>('/auth/account', {
    confirmation,
  });
  return data;
}

export async function acceptWaiver(): Promise<{ accepted: boolean; acceptedAt: string }> {
  const { data } = await api.post<{ accepted: boolean; acceptedAt: string }>('/auth/accept-waiver');
  return data;
}
