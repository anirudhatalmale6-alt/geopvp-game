/**
 * AuthContext
 * Provides auth state (user, isAuthenticated, isLoading) and actions
 * (login, signup, logout, refreshUser) to the entire app tree.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { disconnectSocket } from '../api/socket';
import { stopBackgroundLocation } from '../services/backgroundLocation';

import { ApiError, clearTokens, getToken } from '../api/client';
import {
  getProfile,
  login as apiLogin,
  signup as apiSignup,
  User,
} from '../api/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<User>;
  signup: (
    username: string,
    email: string,
    password: string,
  ) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

type AuthContextValue = AuthState & AuthActions;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ---- Bootstrap: check existing token on mount ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        // Fetch the profile, but be resilient to transient failures at launch.
        // A brief network blip / server hiccup must NOT drop a still-valid
        // session to the login screen — only a real 401 (bad/expired token)
        // should. So we retry non-auth errors with backoff before giving up,
        // and we NEVER clear tokens except on a genuine 401.
        const maxAttempts = 4;
        const backoffs = [1200, 2400, 4000]; // ms between attempts
        let lastErr: unknown = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (cancelled) return;
          try {
            const profile = await getProfile();
            if (!cancelled) setUser(profile);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            // Genuine auth failure — token is bad/expired, stop and clear.
            if (err instanceof ApiError && err.status === 401) {
              await clearTokens();
              return;
            }
            // Transient (network/5xx) — wait and retry, keeping the token.
            if (attempt < maxAttempts - 1) {
              await new Promise((r) => setTimeout(r, backoffs[attempt]));
            }
          }
        }
        // If every attempt failed for a non-auth reason, we deliberately keep
        // the stored token intact. The user may land on the login screen this
        // launch, but their session is preserved and restores on next open.
        if (lastErr) {
          console.log('[Auth] Bootstrap profile fetch failed (kept token):', lastErr);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Actions ----

  const login = useCallback(async (email: string, password: string) => {
    const { user: loggedInUser } = await apiLogin(email, password);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  const signup = useCallback(
    async (username: string, email: string, password: string) => {
      const { user: newUser } = await apiSignup(username, email, password);
      setUser(newUser);
      return newUser;
    },
    [],
  );

  const logout = useCallback(async () => {
    disconnectSocket();
    stopBackgroundLocation();
    await clearTokens();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const profile = await getProfile();
      setUser(profile);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearTokens();
        setUser(null);
      }
    }
  }, []);

  // ---- Memoised value ----

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      signup,
      logout,
      refreshUser,
    }),
    [user, isLoading, login, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
