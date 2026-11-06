import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { ChannelItem, PlaylistItem } from '../types';

export function PageHeader({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between bg-bg/95 px-4 pt-safe backdrop-blur">
      <h1 className="truncate text-xl font-semibold">{title}</h1>
      {right}
    </header>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="mx-4 my-6 rounded-xl border border-line p-4 text-sm">
      <p className="text-danger">{error}</p>
      {retry && (
        <button type="button" onClick={retry} className="mt-3 min-h-11 rounded-full bg-raised px-4">
          Try again
        </button>
      )}
    </div>
  );
}

/** Calls onMore when scrolled into view (infinite scroll), with a button as a fallback. */
export function LoadMore({ onMore, loading }: { onMore: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && !loading && onMore(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore, loading]);
  return (
    <div ref={ref} className="flex justify-center py-4">
      {loading ? <Spinner /> : <button type="button" onClick={onMore} className="min-h-11 rounded-full bg-raised px-5 text-sm">Load more</button>}
    </div>
  );
}

export function ChannelRow({ c }: { c: ChannelItem }) {
  return (
    <li>
      <Link to={`/channel/${c.id}`} className="flex min-h-16 items-center gap-3 rounded-lg px-1 py-2 active:bg-raised">
        {c.avatar ? <img src={c.avatar} alt="" loading="lazy" className="h-12 w-12 rounded-full object-cover" /> : <span className="h-12 w-12 rounded-full bg-raised" />}
        <span className="min-w-0">
          <span className="block truncate font-medium">{c.name}</span>
          {c.subscribers && <span className="block truncate text-xs text-muted">{c.subscribers}</span>}
        </span>
      </Link>
    </li>
  );
}

export function PlaylistRow({ p }: { p: PlaylistItem }) {
  return (
    <li>
      <Link to={`/playlist/${p.id}`} className="flex min-h-16 items-center gap-3 rounded-lg px-1 py-2 active:bg-raised">
        {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" className="h-12 w-[85px] rounded-md object-cover" /> : <span className="h-12 w-[85px] rounded-md bg-raised" />}
        <span className="min-w-0">
          <span className="line-clamp-2 text-[15px] leading-snug">{p.title}</span>
          <span className="block truncate text-xs text-muted">{[p.owner, p.count !== undefined ? `${p.count} videos` : undefined].filter(Boolean).join(' · ')}</span>
        </span>
      </Link>
    </li>
  );
}
