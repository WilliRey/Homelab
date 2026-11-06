// Zustand store: queue, index, mode, repeat, shuffle, radio. Persisted to localStorage.
// The engine (engine.ts) owns the media elements and calls these setters; UI reads them.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { VideoItem } from '../types';

export type RepeatMode = 'off' | 'all' | 'one';
export type PlayMode = 'audio' | 'video';

export type PlayerState = {
  queue: VideoItem[];
  /** Pre-shuffle order, so turning shuffle off restores it. */
  unshuffled: VideoItem[] | null;
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  radio: boolean;
  mode: PlayMode;
  videoHeight: 360 | 480 | 720;

  // Runtime only (not persisted)
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  sheetOpen: boolean;
  radioLoading: boolean;
};

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__encore_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export const usePlayer = create<PlayerState>()(
  persist(
    (): PlayerState => ({
      queue: [],
      unshuffled: null,
      index: 0,
      shuffle: false,
      repeat: 'off',
      radio: true,
      mode: 'audio',
      videoHeight: 480,
      playing: false,
      buffering: false,
      currentTime: 0,
      duration: 0,
      sheetOpen: false,
      radioLoading: false,
    }),
    {
      name: 'encore:player',
      storage: safeStorage,
      partialize: (s) => ({
        queue: s.queue,
        unshuffled: s.unshuffled,
        index: s.index,
        shuffle: s.shuffle,
        repeat: s.repeat,
        radio: s.radio,
        mode: s.mode,
        videoHeight: s.videoHeight,
      }),
    },
  ),
);

export const currentTrack = (s: PlayerState = usePlayer.getState()): VideoItem | undefined => s.queue[s.index];
