// Library: Saved and local playlists. (History and Subscriptions arrive in Phase 5.)
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Empty, PageHeader, Spinner } from '../components/Common';
import { TrackRow } from '../components/TrackRow';
import { playList } from '../player/engine';
import type { LocalPlaylist, VideoItem } from '../types';

export function Library() {
  const [saved, setSaved] = useState<VideoItem[] | null>(null);
  const [lists, setLists] = useState<LocalPlaylist[] | null>(null);
  useEffect(() => {
    api.get<{ items: VideoItem[] }>('/api/library/saved').then((r) => setSaved(r.items)).catch(() => setSaved([]));
    api.get<{ items: LocalPlaylist[] }>('/api/playlists').then((r) => setLists(r.items)).catch(() => setLists([]));
  }, []);
  return (
    <div>
      <PageHeader title="Library" />
      <section className="px-3">
        <h2 className="px-1 pb-1 pt-2 text-sm font-semibold text-muted">Playlists</h2>
        {lists === null ? <Spinner /> : !lists.length ? <p className="px-1 text-sm text-muted">Use “Add to playlist” in any track’s ⋯ menu.</p> : (
          <ul>
            {lists.map((p) => (
              <li key={p.id} className="flex min-h-12 items-center px-1 text-[15px]">{p.name} <span className="ml-2 text-muted">· {p.count ?? 0}</span></li>
            ))}
          </ul>
        )}
        <h2 className="px-1 pb-1 pt-5 text-sm font-semibold text-muted">Saved</h2>
        {saved === null ? <Spinner /> : !saved.length ? <Empty title="Nothing saved yet">Tap ⋯ → Save on any track.</Empty> : (
          <ul>{saved.map((v, i) => <TrackRow key={v.id} item={v} onPlay={() => playList(saved, i)} />)}</ul>
        )}
      </section>
    </div>
  );
}
