import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { ChannelRow, Empty, ErrorNote, LoadMore, PageHeader, PlaylistRow, Spinner } from '../components/Common';
import { CloseIcon, LinkIcon, SearchIcon } from '../components/Icons';
import { TrackRow } from '../components/TrackRow';
import { looksLikeUrl, videoIdFromUrl } from '../lib/format';
import { usePaged } from '../lib/usePaged';
import { playList } from '../player/engine';
import { setMetadata } from '../player/mediaSession';
import { currentTrack, usePlayer } from '../player/store';
import { toast } from '../toast';
import type { ChannelItem, Page, PlaylistItem, ResolvedUrl, VideoItem } from '../types';

type VideoDetails = VideoItem & { playable: boolean };

const TABS = [
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'channels', label: 'Channels' },
  { id: 'playlists', label: 'Playlists' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/**
 * Open a pasted link. Call from the tap: video links are parsed locally and start
 * playing synchronously (an await first would lose the iOS user gesture). Everything
 * else — playlists, channels, @handles, and /shorts/ links (which the server refuses
 * with 422) — goes through /api/resolve.
 */
export async function openLink(url: string, navigate: (to: string) => void, playVideo: (id: string) => void): Promise<void> {
  const local = videoIdFromUrl(url);
  if (local) {
    playVideo(local);
    return;
  }
  const r = await api.get<ResolvedUrl>(`/api/resolve${qs({ url })}`);
  if (r.type === 'video') playVideo(r.id);
  else if (r.type === 'playlist') navigate(`/playlist/${r.id}`);
  else navigate(`/channel/${r.id}`);
}

/** Play a video id we know nothing else about yet; metadata fills in afterwards. */
export function playById(id: string): void {
  const stub: VideoItem = { id, title: 'Loading…', thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, kind: 'video' };
  playList([stub]);
  api
    .get<VideoDetails>(`/api/video/${id}`)
    .then((v) => {
      const s = usePlayer.getState();
      const filled: VideoItem = { ...stub, ...v, kind: 'video' };
      usePlayer.setState({ queue: s.queue.map((q) => (q.id === id && q.title === 'Loading…' ? filled : q)) });
      if (currentTrack()?.id === id) setMetadata(filled);
      if (!v.playable) toast('Live and upcoming videos can’t be played');
    })
    .catch((e: Error) => toast(e.message));
}

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tab = (params.get('type') as Tab) || 'songs';
  const [input, setInput] = useState(q);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => setInput(q), [q]);

  useEffect(() => {
    const term = input.trim();
    if (!focused || !term || looksLikeUrl(term) || term === q) {
      setSuggestions([]);
      return;
    }
    const h = setTimeout(() => {
      api.get<string[]>(`/api/suggest${qs({ q: term })}`).then(setSuggestions).catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(h);
  }, [input, focused, q]);

  const run = (term: string, type: Tab = tab) => {
    const t = term.trim();
    setSuggestions([]);
    (document.activeElement as HTMLElement | null)?.blur();
    if (!t) return;
    if (looksLikeUrl(t)) {
      void submitLink(t);
      return;
    }
    setParams({ q: t, type }, { replace: false });
  };

  const submitLink = async (url: string) => {
    setLinkBusy(true);
    try {
      await openLink(url, navigate, playById);
      setLink('');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setLinkBusy(false);
    }
  };

  const paged = usePaged<VideoItem | ChannelItem | PlaylistItem>(q ? `${tab}:${q}` : null, (next) =>
    api.get<Page<VideoItem | ChannelItem | PlaylistItem>>(`/api/search${qs({ q, type: tab, next })}`),
  );

  return (
    <div>
      <PageHeader title="Search" />
      <div className="px-4">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
          className="relative"
        >
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            enterKeyHint="search"
            aria-label="Search"
            placeholder="Songs, videos, channels"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-11 outline-none focus:border-accent"
          />
          {input && (
            <button type="button" aria-label="Clear" onClick={() => setInput('')} className="tap absolute right-0 top-0 flex items-center justify-center text-muted">
              <CloseIcon size={18} />
            </button>
          )}
          {suggestions.length > 0 && (
            <ul className="absolute inset-x-0 top-13 z-20 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
              {suggestions.slice(0, 8).map((s) => (
                <li key={s}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run(s)} className="flex min-h-11 w-full items-center gap-3 px-4 text-left active:bg-raised">
                    <SearchIcon size={16} className="text-muted" /> {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>

        <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label="Result type">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => (q ? setParams({ q, type: t.id }, { replace: true }) : setParams({ type: t.id }, { replace: true }))}
              className={`min-h-11 flex-1 rounded-lg text-sm ${tab === t.id ? 'bg-raised font-medium text-fg' : 'text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!q && (
        <div className="px-4 pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void submitLink(link.trim());
            }}
            className="rounded-xl border border-dashed border-line p-4"
          >
            <label htmlFor="link" className="flex items-center gap-2 text-sm font-medium">
              <LinkIcon size={16} /> Paste a link
            </label>
            <p className="mt-1 text-xs text-muted">A video, song, playlist or channel link.</p>
            <div className="mt-3 flex gap-2">
              <input
                id="link"
                type="url"
                inputMode="url"
                placeholder="https://youtu.be/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 outline-none focus:border-accent"
              />
              <button type="submit" disabled={!link.trim() || linkBusy} className="h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50">
                {linkBusy ? '…' : 'Open'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="px-3 pt-3" data-testid="results">
        {paged.error && <ErrorNote error={paged.error} retry={paged.reload} />}
        {q && !paged.loading && !paged.error && paged.items.length === 0 && <Empty title="No results" />}
        <ul>
          {(tab === 'songs' || tab === 'videos') &&
            (paged.items as VideoItem[]).map((v) => <TrackRow key={v.id} item={v} onPlay={() => playList([v])} />)}
          {tab === 'channels' && (paged.items as ChannelItem[]).map((c) => <ChannelRow key={c.id} c={c} />)}
          {tab === 'playlists' && (paged.items as PlaylistItem[]).map((p) => <PlaylistRow key={p.id} p={p} />)}
        </ul>
        {paged.loading && !paged.items.length && <Spinner />}
        {paged.next && paged.items.length > 0 && <LoadMore onMore={paged.more} loading={paged.loading} />}
      </div>
    </div>
  );
}
