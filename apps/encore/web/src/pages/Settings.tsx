import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/Common';
import { isIOS } from '../lib/format';

type Health = { ok: boolean; ytdlpVersion: string | null; denoVersion: string | null; potProvider: 'up' | 'down'; db: string };

export function Settings() {
  const [health, setHealth] = useState<Health | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    api.get<Health>('/api/health').then(setHealth).catch(() => undefined);
  }, []);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    navigate('/login', { replace: true });
  };

  const row = 'flex min-h-12 items-center justify-between gap-4 border-b border-line px-4 text-[15px]';
  return (
    <div>
      <PageHeader title="Settings" />
      <section className="mx-4 overflow-hidden rounded-xl bg-surface">
        <div className={row}><span>Theme</span><span className="text-sm text-muted">Follows system</span></div>
        <div className={row}><span>Running as</span><span className="text-sm text-muted">{standalone ? 'Home-Screen app' : 'Browser tab'}</span></div>
        {isIOS() && (
          <p className="px-4 py-3 text-xs text-muted">
            On iPhone, background audio is most reliable in a Safari tab. If the Home-Screen app stops when locked, use Safari instead.
          </p>
        )}
      </section>

      <h2 className="px-5 pb-1 pt-6 text-sm font-semibold text-muted">Server</h2>
      <section className="mx-4 overflow-hidden rounded-xl bg-surface" data-testid="health">
        <div className={row}><span>yt-dlp</span><span className="text-sm text-muted">{health?.ytdlpVersion ?? '—'}</span></div>
        <div className={row}><span>Deno</span><span className="text-sm text-muted">{health?.denoVersion ?? '—'}</span></div>
        <div className={row}><span>Token provider</span><span className={`text-sm ${health?.potProvider === 'up' ? 'text-accent' : 'text-danger'}`}>{health?.potProvider ?? '—'}</span></div>
        <div className={row}><span>Database</span><span className="text-sm text-muted">{health?.db ?? '—'}</span></div>
      </section>

      <div className="mx-4 mt-6">
        <button type="button" onClick={logout} className="min-h-12 w-full rounded-xl bg-surface text-danger">Log out</button>
      </div>
    </div>
  );
}
