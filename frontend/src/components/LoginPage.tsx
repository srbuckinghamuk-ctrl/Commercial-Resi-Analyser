/**
 * `/login` (R17, design §10.6). Email and password, the server's refusal
 * verbatim, and a redirect back to where the user came from (`state.from`,
 * set by the links that point here) or the pipeline.
 *
 * The server answers every failed login with the same 401 "invalid
 * credentials" -- it does not say whether the account exists. So when a 401
 * comes back and this page has never seen a signed-in user, the spec's
 * unavailable sentence is shown alongside: on a server with no users
 * configured it is the only explanation, and on one with users it is a
 * harmless reminder that credentials have to be created by an administrator.
 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError, formatApiErrorDetail } from '../lib/api';

export const GOVERNANCE_UNAVAILABLE =
  'Lender governance unavailable — no authenticated users are configured on this server';

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0a1628';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: '#0f172a', border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 14, boxSizing: 'border-box',
};

export default function LoginPage() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [unauthorised, setUnauthorised] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setUnauthorised(false);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const lines = formatApiErrorDetail(err.detail);
        setError(lines.length > 0 ? lines : [err.message]);
        setUnauthorised(err.status === 401);
      } else {
        setError([err instanceof Error ? err.message : String(err)]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: 24, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
      <h2 style={{ color: TEXT, fontSize: 18, margin: '0 0 6px' }}>Sign in</h2>
      <p style={{ color: MUTED, fontSize: 13, margin: '0 0 18px' }}>
        Browsing needs no account. Opening or moving a lender case, importing a benchmark set,
        and the governed resave need a signed-in user — accounts are created by an administrator.
      </p>

      {user != null && (
        <div style={{ color: MUTED, fontSize: 13, marginBottom: 14 }}>
          Signed in as <span style={{ color: TEXT }}>{user.display_name}</span> ({user.role}).{' '}
          <button type="button" onClick={() => void logout()} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 13, padding: 0 }}>
            Sign out
          </button>
          {' · '}
          <Link to={from} style={{ color: '#60a5fa' }}>Continue</Link>
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)}>
        <label htmlFor="login-email" style={{ display: 'block', color: MUTED, fontSize: 12, marginBottom: 4 }}>Email</label>
        <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} required />
        <label htmlFor="login-password" style={{ display: 'block', color: MUTED, fontSize: 12, marginBottom: 4 }}>Password</label>
        <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} required />
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '8px 18px', background: submitting ? '#334155' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 14 }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {error != null && (
        <div role="alert" style={{ marginTop: 14, padding: '10px 12px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 6 }}>
          {error.map((line, i) => <div key={i} style={{ color: '#fca5a5', fontSize: 13 }}>{line}</div>)}
          {unauthorised && user == null && (
            <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 6 }}>
              If no accounts have been created: {GOVERNANCE_UNAVAILABLE}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
