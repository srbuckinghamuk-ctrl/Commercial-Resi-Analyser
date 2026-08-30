/**
 * Authentication context (R17, design §10.6).
 *
 * One provider at the top of the app; `useAuth()` anywhere below it. The
 * token lives in sessionStorage (`cra.auth_token`) so a reload keeps the
 * session while a closed tab ends it, and in api.ts's module store so every
 * request carries it. On mount a stored token is verified with GET /auth/me:
 * a 401 (expired, or the user was deactivated) discards it silently rather
 * than leaving a token the server will refuse on every write.
 *
 * `useAuth()` works without a provider -- it returns the signed-out state --
 * so components that merely read it (LenderCasePage, ProjectDetail) can be
 * rendered in isolation. `login()` without a provider throws.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '../types';
import { login as apiLogin, logout as apiLogout, me as apiMe, setAuthToken } from './api';

export const AUTH_TOKEN_STORAGE_KEY = 'cra.auth_token';

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  /** True while a stored token is being verified on mount. */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

function readStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token == null) window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    else window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode, quota): the session lives in memory only.
  }
}

const SIGNED_OUT: AuthState = {
  user: null,
  token: null,
  loading: false,
  login: async () => {
    throw new Error('AuthProvider is not mounted');
  },
  logout: async () => {},
};

const AuthContext = createContext<AuthState>(SIGNED_OUT);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // True only while a stored token is being verified; with nothing stored
  // there is nothing to wait for, decided at first render rather than in
  // the effect.
  const [loading, setLoading] = useState(() => readStoredToken() != null);

  useEffect(() => {
    const stored = readStoredToken();
    if (stored == null) return;
    let cancelled = false;
    setAuthToken(stored);
    apiMe()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setToken(stored);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthToken(null);
        writeStoredToken(null);
        setUser(null);
        setToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setAuthToken(res.token);
    writeStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Stateless tokens: the server has nothing to revoke, and a failed
      // call must not keep the client signed in.
    }
    setAuthToken(null);
    writeStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- a hook exported beside its provider, the same shape as area-unit-context's useAreaUnit
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
