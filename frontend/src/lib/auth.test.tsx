import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// R17 design §10.6. Only the network boundary is mocked; the token store in
// api.ts is the real one, so "sets the bearer for later requests" is proved
// against the module every caller uses.
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  };
});

const { AuthProvider, useAuth, AUTH_TOKEN_STORAGE_KEY } = await import('./auth');
const { login, logout, me, getAuthToken, ApiError } = await import('./api');

const USER = { id: 'u1', email: 'dev@example.com', display_name: 'D. Developer', role: 'developer' as const, is_active: true };

function Probe() {
  const { user, token, loading, login: doLogin, logout: doLogout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? `${user.display_name} (${user.role})` : 'signed out'}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => void doLogin('dev@example.com', 'pw').catch(() => {})}>login</button>
      <button onClick={() => void doLogout()}>logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.mocked(login).mockReset();
  vi.mocked(logout).mockReset();
  vi.mocked(me).mockReset();
  window.sessionStorage.clear();
});

describe('AuthProvider', () => {
  it('starts signed out with nothing stored and does not call /auth/me', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('signed out');
    expect(me).not.toHaveBeenCalled();
    expect(getAuthToken()).toBeNull();
  });

  it('login stores the token in sessionStorage, the api store, and exposes the user', async () => {
    vi.mocked(login).mockResolvedValue({ token: 'tok-1', user: USER });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('D. Developer (developer)'));
    expect(login).toHaveBeenCalledWith('dev@example.com', 'pw');
    expect(window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('tok-1');
    expect(getAuthToken()).toBe('tok-1');
    expect(screen.getByTestId('token').textContent).toBe('tok-1');
  });

  it('restores a stored token through GET /auth/me on mount', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'tok-stored');
    vi.mocked(me).mockResolvedValue(USER);
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('D. Developer (developer)'));
    expect(me).toHaveBeenCalledTimes(1);
    expect(getAuthToken()).toBe('tok-stored');
  });

  it('discards a stored token the server refuses (401 on /auth/me)', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'tok-expired');
    vi.mocked(me).mockRejectedValue(new ApiError(401, 'HTTP 401', 'authentication required'));
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('signed out');
    expect(window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(getAuthToken()).toBeNull();
  });

  it('logout clears the user, the stored token and the api store even when the server call fails', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'tok-stored');
    vi.mocked(me).mockResolvedValue(USER);
    vi.mocked(logout).mockRejectedValue(new Error('network'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user').textContent).not.toBe('signed out'));

    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('signed out'));
    expect(window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(getAuthToken()).toBeNull();
  });

  it('useAuth without a provider is the signed-out state', () => {
    render(<Probe />);
    expect(screen.getByTestId('user').textContent).toBe('signed out');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});
