import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, login: vi.fn(), logout: vi.fn(), me: vi.fn() };
});

const { default: LoginPage, GOVERNANCE_UNAVAILABLE } = await import('./LoginPage');
const { AuthProvider } = await import('../lib/auth');
const { login, ApiError } = await import('../lib/api');

const USER = { id: 'u1', email: 'dev@example.com', display_name: 'D. Developer', role: 'developer' as const, is_active: true };

function renderLogin(from?: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from } : null }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>PIPELINE</div>} />
          <Route path="/projects/:id/calculator/lender-case" element={<div>LENDER CASE PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dev@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  vi.mocked(login).mockReset();
  window.sessionStorage.clear();
});

describe('LoginPage', () => {
  it('signs in and redirects back to where the user came from', async () => {
    vi.mocked(login).mockResolvedValue({ token: 'tok', user: USER });
    renderLogin('/projects/p1/calculator/lender-case');
    fill();
    expect(await screen.findByText('LENDER CASE PAGE')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith('dev@example.com', 'pw');
  });

  it('redirects to the pipeline when there is nowhere to go back to', async () => {
    vi.mocked(login).mockResolvedValue({ token: 'tok', user: USER });
    renderLogin();
    fill();
    expect(await screen.findByText('PIPELINE')).toBeInTheDocument();
  });

  it('prints the server refusal verbatim, plus the unavailable sentence on a 401 with no user ever seen', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(401, 'HTTP 401', 'invalid credentials'));
    renderLogin();
    fill();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('invalid credentials');
    expect(alert).toHaveTextContent(GOVERNANCE_UNAVAILABLE);
    expect(screen.queryByText('PIPELINE')).not.toBeInTheDocument();
  });

  it('a non-401 failure shows the detail without the unavailable sentence', async () => {
    vi.mocked(login).mockRejectedValue(
      new ApiError(422, 'HTTP 422', [{ loc: ['body', 'email'], msg: "email must contain '@' with text on both sides" }]),
    );
    renderLogin();
    fill();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("body.email: email must contain '@' with text on both sides");
    expect(alert).not.toHaveTextContent(GOVERNANCE_UNAVAILABLE);
  });

  it('keeps the button usable after a failure', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(401, 'HTTP 401', 'invalid credentials'));
    renderLogin();
    fill();
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
  });
});
