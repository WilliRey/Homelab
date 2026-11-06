import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Logo } from '../components/Logo';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait a minute.' : 'Wrong password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 pb-safe pt-safe">
      <div className="text-accent">
        <Logo size={64} />
      </div>
      <h1 className="mt-4 text-3xl font-semibold">Encore</h1>
      <form onSubmit={submit} className="mt-8 w-full max-w-xs">
        <label htmlFor="pw" className="text-sm text-muted">Password</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 h-12 w-full rounded-xl border border-line bg-surface px-4 outline-none focus:border-accent"
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !password} className="mt-4 h-12 w-full rounded-xl bg-accent font-medium text-accent-fg disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
