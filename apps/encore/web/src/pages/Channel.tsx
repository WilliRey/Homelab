import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Empty, ErrorNote, LoadMore, PlaylistRow, Spinner } from '../components/Common';
import { ChevronLeftIcon } from '../components/Icons';
import { TrackRow } from '../components/TrackRow';
import { usePaged } from '../lib/usePaged';
import { playList } from '../player/engine';
import type { ChannelItem, PlaylistItem, VideoItem } from '../types';

type ChannelInfo = ChannelItem & { handle?: string; subscribed?: boolean };
type Resp = { channel: ChannelInfo; items: Array<VideoItem | PlaylistItem>; next?: string };

// Only the Videos and Playlists tabs exist. There is no Shorts tab.
const TABS = [
  { id: 'videos', label: 'Videos' },
  { id: 'playlists', label: 'Playlists' },
] as const;

export function Channel() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<'videos' | 'playlists'>('videos');
  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const navigate = useNavigate();

  useEffect(() => setInfo(null), [id]);

  const paged = usePaged<VideoItem | PlaylistItem>(`${id}:${tab}`, async (next) => {
    const r = await api.get<Resp>(`/api/channel/${id}${qs({ tab, next })}`);
    setInfo(r.channel);
    return { items: r.items, next: r.next };
  });

  const videos = tab === 'videos' ? (paged.items as VideoItem[]) : [];

  return (
    <div>
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-1 bg-bg/95 px-2 pt-safe backdrop-blur">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="tap flex items-center justify-center rounded-full">
          <ChevronLeftIcon />
        </button>
        <h1 className="truncate text-lg font-semibold">{info?.name ?? ''}</h1>
      </header>

      {info && (
        <div className="flex items-center gap-4 px-4 pb-2 pt-2">
          {info.avatar && <img src={info.avatar} alt="" className="h-20 w-20 rounded-full object-cover" />}
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold">{info.name}</h2>
            <p className="truncate text-sm text-muted">{[info.handle, info.subscribers].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      )}

      <div className="mx-4 mt-2 flex gap-1 rounded-xl bg-surface p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 flex-1 rounded-lg text-sm ${tab === t.id ? 'bg-raised font-medium' : 'text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-3 pt-3">
        {paged.error && <ErrorNote error={paged.error} retry={paged.reload} />}
        {!paged.loading && !paged.error && paged.items.length === 0 && <Empty title={tab === 'videos' ? 'No videos' : 'No playlists'} />}
        <ul>
          {tab === 'videos' && videos.map((v, i) => <TrackRow key={v.id} item={v} onPlay={() => playList(videos, i)} />)}
          {tab === 'playlists' && (paged.items as PlaylistItem[]).map((p) => <PlaylistRow key={p.id} p={p} />)}
        </ul>
        {paged.loading && !paged.items.length && <Spinner />}
        {paged.next && paged.items.length > 0 && <LoadMore onMore={paged.more} loading={paged.loading} />}
      </div>
    </div>
  );
}
