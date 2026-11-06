import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Empty, ErrorNote, LoadMore, Spinner } from '../components/Common';
import { ChevronLeftIcon, PlayIcon, ShuffleIcon } from '../components/Icons';
import { TrackRow } from '../components/TrackRow';
import { usePaged } from '../lib/usePaged';
import { playList, setShuffle } from '../player/engine';
import type { PlaylistItem, VideoItem } from '../types';

type Resp = PlaylistItem & { items: VideoItem[]; next?: string };

export function Playlist() {
  const { id = '' } = useParams();
  const [info, setInfo] = useState<PlaylistItem | null>(null);
  const navigate = useNavigate();
  const paged = usePaged<VideoItem>(id, async (next) => {
    const r = await api.get<Resp>(`/api/playlist/${id}${qs({ next })}`);
    if (!next) setInfo(r);
    return { items: r.items, next: r.next };
  });
  const items = paged.items;

  return (
    <div>
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-1 bg-bg/95 px-2 pt-safe backdrop-blur">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="tap flex items-center justify-center rounded-full">
          <ChevronLeftIcon />
        </button>
        <h1 className="truncate text-lg font-semibold">{info?.title ?? ''}</h1>
      </header>
      {info && (
        <div className="px-4 pt-2">
          {info.thumbnail && <img src={info.thumbnail} alt="" className="aspect-video w-full max-w-sm rounded-xl object-cover" />}
          <h2 className="mt-3 text-xl font-semibold">{info.title}</h2>
          <p className="text-sm text-muted">{[info.owner, info.count !== undefined ? `${info.count} videos` : undefined].filter(Boolean).join(' · ')}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={!items.length} onClick={() => playList(items)} className="flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg disabled:opacity-50">
              <PlayIcon size={18} /> Play
            </button>
            <button
              type="button"
              disabled={!items.length}
              onClick={() => {
                const start = Math.floor(Math.random() * items.length);
                playList(items, start);
                setShuffle(true);
              }}
              className="flex min-h-11 items-center gap-2 rounded-full bg-raised px-5 text-sm disabled:opacity-50"
            >
              <ShuffleIcon size={18} /> Shuffle
            </button>
          </div>
        </div>
      )}
      <div className="px-3 pt-3">
        {paged.error && <ErrorNote error={paged.error} retry={paged.reload} />}
        {!paged.loading && !paged.error && !items.length && <Empty title="This playlist is empty" />}
        <ul>
          {items.map((v, i) => (
            <TrackRow key={`${v.id}-${i}`} item={v} onPlay={() => playList(items, i)} />
          ))}
        </ul>
        {paged.loading && !items.length && <Spinner />}
        {paged.next && items.length > 0 && <LoadMore onMore={paged.more} loading={paged.loading} />}
      </div>
    </div>
  );
}
