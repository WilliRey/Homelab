// TrackMenu (⋯): Play now, Play next, Add to queue, Save, Add to playlist, Go to channel.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { api } from '../api';
import { addToQueue, playNext, playNow } from '../player/engine';
import { usePlayer } from '../player/store';
import { toast } from '../toast';
import type { LocalPlaylist, VideoItem } from '../types';
import { ChevronLeftIcon, HeartIcon, NextIcon, PlayIcon, PlusIcon, QueueIcon, UserIcon } from './Icons';
import { ActionSheet, SheetButton } from './Sheet';

type Extra = { label: string; onClick: () => void }[];
type MenuState = { item: VideoItem | null; extra: Extra; open: (item: VideoItem, extra?: Extra) => void; close: () => void };

const useMenu = create<MenuState>((set) => ({
  item: null,
  extra: [],
  open: (item, extra = []) => set({ item, extra }),
  close: () => set({ item: null, extra: [] }),
}));

export const openTrackMenu = (item: VideoItem, extra?: Extra) => useMenu.getState().open(item, extra);

const trackBody = (t: VideoItem) => ({
  id: t.id, title: t.title, channelId: t.channelId, channelName: t.channelName, durationSec: t.durationSec, thumbnail: t.thumbnail, kind: t.kind,
});

export function TrackMenu() {
  const { item, extra, close } = useMenu();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const [lists, setLists] = useState<LocalPlaylist[] | null>(null);

  useEffect(() => {
    setPicking(false);
    setSaved(null);
    if (item) api.get<{ saved: boolean }>(`/api/library/saved/${item.id}`).then((r) => setSaved(r.saved)).catch(() => undefined);
  }, [item]);

  useEffect(() => {
    if (picking) api.get<{ items: LocalPlaylist[] }>('/api/playlists').then((r) => setLists(r.items)).catch(() => setLists([]));
  }, [picking]);

  if (!item) return null;
  const done = (fn: () => void) => () => {
    fn();
    close();
  };

  const toggleSave = async () => {
    try {
      if (saved) await api.del(`/api/library/saved/${item.id}`);
      else await api.put(`/api/library/saved/${item.id}`, trackBody(item));
      toast(saved ? 'Removed from Saved' : 'Saved');
    } catch {
      toast("Couldn't update Saved");
    }
    close();
  };

  const addTo = async (pl: LocalPlaylist) => {
    try {
      await api.post(`/api/playlists/${pl.id}/items`, trackBody(item));
      toast(`Added to ${pl.name}`);
    } catch {
      toast("Couldn't add to playlist");
    }
    close();
  };

  const createAndAdd = async () => {
    const name = prompt('New playlist name')?.trim();
    if (!name) return;
    const pl = await api.post<{ id: number; name: string }>('/api/playlists', { name });
    await addTo(pl);
  };

  const title = (
    <div className="flex items-center gap-3">
      <img src={item.thumbnail} alt="" className="h-10 w-10 rounded object-cover" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.title}</div>
        <div className="truncate text-xs text-muted">{item.channelName}</div>
      </div>
    </div>
  );

  return (
    <ActionSheet open onClose={close} title={title}>
      {picking ? (
        <>
          <SheetButton icon={<ChevronLeftIcon size={18} />} onClick={() => setPicking(false)}>Back</SheetButton>
          <SheetButton icon={<PlusIcon size={18} />} onClick={createAndAdd}>New playlist…</SheetButton>
          {lists === null && <p className="px-5 py-3 text-sm text-muted">Loading…</p>}
          {lists?.map((pl) => (
            <SheetButton key={pl.id} icon={<QueueIcon size={18} />} onClick={() => addTo(pl)}>
              {pl.name} <span className="text-muted">· {pl.count ?? 0}</span>
            </SheetButton>
          ))}
        </>
      ) : (
        <>
          {/* Play now must call play() synchronously in this tap: no await before it. */}
          <SheetButton icon={<PlayIcon size={18} />} onClick={done(() => playNow(item))}>Play now</SheetButton>
          <SheetButton icon={<NextIcon size={18} />} onClick={done(() => playNext(item))}>Play next</SheetButton>
          <SheetButton icon={<QueueIcon size={18} />} onClick={done(() => addToQueue(item))}>Add to queue</SheetButton>
          <SheetButton icon={<HeartIcon size={18} filled={!!saved} />} onClick={toggleSave}>{saved ? 'Remove from Saved' : 'Save'}</SheetButton>
          <SheetButton icon={<PlusIcon size={18} />} onClick={() => setPicking(true)}>Add to playlist</SheetButton>
          {item.channelId && (
            <SheetButton
              icon={<UserIcon size={18} />}
              onClick={done(() => {
                usePlayer.setState({ sheetOpen: false });
                navigate(`/channel/${item.channelId}`);
              })}
            >
              Go to channel
            </SheetButton>
          )}
          {extra.map((x) => (
            <SheetButton key={x.label} onClick={done(x.onClick)}>{x.label}</SheetButton>
          ))}
        </>
      )}
    </ActionSheet>
  );
}
