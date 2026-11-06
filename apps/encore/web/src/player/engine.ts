// The player engine (PLAN.md section 5). Background playback depends on these rules:
//
//  - ONE <audio> element, created at startup and appended to <body> outside React.
//    Nothing else ever plays sound. It is the master clock.
//  - ONE muted <video playsinline> element, reparented by PlayerSheet in Video mode
//    (Phase 6). It never carries sound.
//  - First play happens synchronously inside the tap handler: set src, call play(),
//    and only then do anything async. An `await` first loses the iOS user gesture.
//  - Track changes reuse the same element straight from the `ended` handler, no await.
//  - Nothing that must happen in the background uses timers; media events drive it.
//  - No Web Audio API. No volume control (iOS ignores audio.volume).
import { api, beacon } from '../api';
import { toast } from '../toast';
import type { VideoItem } from '../types';
import { registerHandlers, setMetadata, setPlaybackState, setPosition } from './mediaSession';
import { currentTrack, usePlayer, type PlayerState } from './store';

const POSITION_KEY = 'encore:position';
const WAITING_LIMIT_MS = 15_000;
const PREVIOUS_RESTART_SEC = 3;
const PREFETCH_AHEAD = 2;
const RADIO_LOW_WATER = 3;

let audio: HTMLAudioElement;
let video: HTMLVideoElement;
let started = false;

/** Per-track runtime state, reset on every load. */
let track = {
  id: '',
  retried: false,
  startedOnce: false,
  pendingSeek: 0,
  waitingSince: 0,
};
/** True after a restore until the first play: the src isn't set yet. */
let needsLoad = false;

const set = (p: Partial<PlayerState>) => usePlayer.setState(p);
const get = () => usePlayer.getState();

export const getAudio = () => audio;
export const getVideo = () => video;
export const streamUrl = (id: string, fresh = false) => `/api/stream/${id}/audio${fresh ? '?fresh=1' : ''}`;

// ---------------------------------------------------------------------------
// Startup

export function initEngine(): void {
  if (started) return;
  started = true;

  audio = document.createElement('audio');
  audio.id = 'encore-audio';
  audio.preload = 'auto';
  audio.setAttribute('x-webkit-airplay', 'allow');
  document.body.appendChild(audio);

  video = document.createElement('video');
  video.id = 'encore-video';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';

  // Safari 16.4+: keep playing with the silent switch on and in the background.
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      /* ignore */
    }
  }

  wireAudioEvents();
  registerHandlers({
    play: () => resume(),
    pause: () => audio.pause(),
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
    previous: () => previous(),
    next: () => next(),
    seekTo: (t) => seek(t),
  });
  restore();
  wireResumeSaving();
}

function wireAudioEvents(): void {
  audio.addEventListener('loadedmetadata', () => {
    if (track.pendingSeek > 0 && track.pendingSeek < audio.duration) audio.currentTime = track.pendingSeek;
    track.pendingSeek = 0;
    set({ duration: audio.duration });
    setPosition(audio);
  });
  audio.addEventListener('durationchange', () => set({ duration: audio.duration }));
  audio.addEventListener('play', () => {
    set({ playing: true });
    setPlaybackState('playing');
    setPosition(audio);
  });
  audio.addEventListener('playing', () => {
    track.waitingSince = 0;
    set({ buffering: false });
    if (!track.startedOnce) {
      track.startedOnce = true;
      onTrackStarted();
    }
  });
  audio.addEventListener('pause', () => {
    set({ playing: false });
    setPlaybackState('paused');
    setPosition(audio);
  });
  audio.addEventListener('seeked', () => setPosition(audio));
  audio.addEventListener('ratechange', () => setPosition(audio));
  audio.addEventListener('timeupdate', () => {
    if (track.waitingSince && !audio.paused && audio.readyState >= 3) track.waitingSince = 0;
    checkStall();
    set({ currentTime: audio.currentTime });
  });
  audio.addEventListener('waiting', () => {
    if (!track.waitingSince) track.waitingSince = Date.now();
    set({ buffering: true });
  });
  for (const ev of ['progress', 'stalled', 'suspend']) audio.addEventListener(ev, checkStall);
  audio.addEventListener('canplay', () => set({ buffering: false }));
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);

  // Foreground-only backup for the stall check; in the background the events above do it.
  setInterval(() => {
    if (document.visibilityState === 'visible') checkStall();
  }, 1000);
}

// ---------------------------------------------------------------------------
// Loading and playing (all synchronous up to play())

/** Point the audio element at a queue index and start it. Must stay synchronous. */
function load(index: number, opts: { autoplay?: boolean; startAt?: number } = {}): void {
  const s = get();
  const t = s.queue[index];
  if (!t) return;
  track = { id: t.id, retried: false, startedOnce: false, pendingSeek: opts.startAt ?? 0, waitingSince: 0 };
  needsLoad = false;
  set({ index, currentTime: opts.startAt ?? 0, duration: t.durationSec ?? 0, buffering: true });
  audio.src = streamUrl(t.id);
  if (opts.autoplay !== false) {
    const p = audio.play();
    p?.catch((err: unknown) => {
      // NotAllowedError: no user gesture (e.g. restored session). Not a playback failure.
      if ((err as DOMException)?.name !== 'AbortError') set({ playing: false, buffering: false });
    });
  }
  setMetadata(t);
}

/** Replace the queue and play `start`. Call directly from a tap handler. */
export function playList(items: VideoItem[], start = 0): void {
  if (!items.length) return;
  set({ queue: items.slice(), unshuffled: null, shuffle: false });
  load(start);
}

export function playNow(item: VideoItem): void {
  const s = get();
  if (!s.queue.length) return playList([item]);
  const q = s.queue.slice();
  q.splice(s.index + 1, 0, item);
  set({ queue: q, unshuffled: s.unshuffled ? [...s.unshuffled, item] : null });
  load(s.index + 1);
}

export function playNext(item: VideoItem): void {
  const s = get();
  const q = s.queue.slice();
  q.splice(s.queue.length ? s.index + 1 : 0, 0, item);
  set({ queue: q, unshuffled: s.unshuffled ? [...s.unshuffled, item] : null });
  toast(`Playing next: ${item.title}`);
}

export function addToQueue(items: VideoItem | VideoItem[]): void {
  const add = Array.isArray(items) ? items : [items];
  const s = get();
  set({ queue: [...s.queue, ...add], unshuffled: s.unshuffled ? [...s.unshuffled, ...add] : null });
  toast(add.length === 1 ? `Added to queue: ${add[0]!.title}` : `Added ${add.length} to queue`);
}

export function playIndex(i: number): void {
  if (i >= 0 && i < get().queue.length) load(i);
}

export function removeFromQueue(i: number): void {
  const s = get();
  if (i === s.index || i < 0 || i >= s.queue.length) return;
  const q = s.queue.slice();
  const [gone] = q.splice(i, 1);
  set({
    queue: q,
    index: i < s.index ? s.index - 1 : s.index,
    unshuffled: s.unshuffled ? s.unshuffled.filter((x) => x !== gone) : null,
  });
}

/** Play/pause from the UI. Resuming a restored session loads it here, inside the tap. */
export function togglePlay(): void {
  if (audio.paused) resume();
  else audio.pause();
}

function resume(): void {
  const s = get();
  if (!s.queue.length) return;
  if (needsLoad || !audio.src) {
    load(s.index, { startAt: s.currentTime });
    return;
  }
  audio.play().catch(() => undefined);
}

export function seek(t: number): void {
  if (needsLoad) {
    set({ currentTime: t });
    return;
  }
  if (Number.isFinite(t)) audio.currentTime = Math.max(0, t);
}

// ---------------------------------------------------------------------------
// Advancing

/** Index to play after the current one, or -1. Pure function of the store. */
export function nextIndex(s: PlayerState, auto: boolean): number {
  if (auto && s.repeat === 'one') return s.index;
  if (s.index + 1 < s.queue.length) return s.index + 1;
  if (s.repeat === 'all' && s.queue.length) return 0;
  return -1;
}

export function next(): void {
  const i = nextIndex(get(), false);
  if (i >= 0) load(i);
  else {
    audio.pause();
    toast('End of queue');
  }
}

export function previous(): void {
  if (audio.currentTime > PREVIOUS_RESTART_SEC || get().index === 0) {
    audio.currentTime = 0;
    if (audio.paused) resume();
    return;
  }
  load(get().index - 1);
}

function onEnded(): void {
  // Runs in the background with the screen locked: no awaits before play().
  const s = get();
  const i = nextIndex(s, true);
  if (i === s.index && s.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => undefined);
    return;
  }
  if (i >= 0) {
    load(i);
    return;
  }
  set({ playing: false });
  if (s.radio) {
    // The radio top-up should have run long before this; try once more as a fallback.
    topUpRadio(true);
  }
}

function onError(): void {
  const t = currentTrack();
  if (!t || !audio.src || t.id !== track.id) return;
  if (!track.retried) {
    // Retry once with ?fresh=1: the server re-resolves and skips its cache.
    track.retried = true;
    const at = audio.currentTime;
    track.pendingSeek = at > 1 ? at : 0;
    audio.src = streamUrl(t.id, true);
    audio.play().catch(() => undefined);
    return;
  }
  skipBroken(t);
}

function checkStall(): void {
  if (!track.waitingSince || audio.paused) return;
  if (Date.now() - track.waitingSince < WAITING_LIMIT_MS) return;
  track.waitingSince = 0;
  const t = currentTrack();
  if (!t) return;
  if (!track.retried) {
    onError();
    return;
  }
  skipBroken(t);
}

function skipBroken(t: VideoItem): void {
  toast(`Couldn't play ${t.title}`);
  const i = nextIndex(get(), false);
  if (i >= 0 && i !== get().index) load(i);
  else {
    audio.pause();
    set({ playing: false, buffering: false });
  }
}

// ---------------------------------------------------------------------------
// When a track actually starts: history, prefetch, radio

function onTrackStarted(): void {
  const s = get();
  const t = currentTrack(s);
  if (!t) return;
  beacon('/api/history', {
    id: t.id, title: t.title, channelName: t.channelName, durationSec: t.durationSec, thumbnail: t.thumbnail, kind: t.kind,
  });
  for (const n of s.queue.slice(s.index + 1, s.index + 1 + PREFETCH_AHEAD)) beacon(`/api/prefetch/${n.id}`, {});
  topUpRadio(false);
}

let radioInflight = false;

/** Radio autoplay: when fewer than 3 tracks remain, fetch more now, not at the end. */
export function topUpRadio(playWhenDone: boolean): void {
  const s = get();
  if (!s.radio || radioInflight) return;
  const remaining = s.queue.length - 1 - s.index;
  if (remaining >= RADIO_LOW_WATER && !playWhenDone) return;
  const seed = currentTrack(s);
  if (!seed) return;
  radioInflight = true;
  set({ radioLoading: true });
  api
    .get<{ items: VideoItem[] }>(`/api/music/upnext/${seed.id}`)
    .then(({ items }) => {
      const now = get();
      const have = new Set(now.queue.map((q) => q.id));
      const fresh = items.filter((x) => !have.has(x.id)).slice(0, 25);
      if (!fresh.length) return;
      set({ queue: [...now.queue, ...fresh], unshuffled: now.unshuffled ? [...now.unshuffled, ...fresh] : null });
      const after = get();
      for (const n of after.queue.slice(after.index + 1, after.index + 1 + PREFETCH_AHEAD)) beacon(`/api/prefetch/${n.id}`, {});
      if (playWhenDone && audio.ended) load(after.index + 1);
    })
    .catch(() => undefined)
    .finally(() => {
      radioInflight = false;
      set({ radioLoading: false });
    });
}

// ---------------------------------------------------------------------------
// Modes

export function setShuffle(on: boolean): void {
  const s = get();
  if (on === s.shuffle) return;
  const cur = currentTrack(s);
  if (on) {
    const rest = s.queue.filter((_, i) => i !== s.index);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    set({ shuffle: true, unshuffled: s.queue, queue: cur ? [cur, ...rest] : rest, index: 0 });
  } else {
    const original = s.unshuffled ?? s.queue;
    const idx = cur ? Math.max(0, original.indexOf(cur)) : 0;
    set({ shuffle: false, unshuffled: null, queue: original, index: idx });
  }
}

export function cycleRepeat(): void {
  const order = ['off', 'all', 'one'] as const;
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
}

export function setRadio(on: boolean): void {
  set({ radio: on });
  if (on && get().playing) topUpRadio(false);
}

// ---------------------------------------------------------------------------
// Resume: {queue, index, currentTime} saved every 5 s while visible and on pagehide

function savePosition(): void {
  try {
    const t = currentTrack();
    if (t && !needsLoad) localStorage.setItem(POSITION_KEY, JSON.stringify({ id: t.id, time: audio.currentTime }));
  } catch {
    /* storage unavailable */
  }
}

function wireResumeSaving(): void {
  setInterval(() => {
    if (document.visibilityState === 'visible' && !audio.paused) savePosition();
  }, 5000);
  addEventListener('pagehide', savePosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePosition();
  });
}

/** On load: restore the queue paused. The src is set on the first play tap. */
function restore(): void {
  const s = get();
  const t = currentTrack(s);
  if (!t) return;
  let time = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null') as { id: string; time: number } | null;
    if (saved?.id === t.id && Number.isFinite(saved.time)) time = saved.time;
  } catch {
    /* ignore */
  }
  needsLoad = true;
  set({ currentTime: time, duration: t.durationSec ?? 0, playing: false, buffering: false });
  setMetadata(t);
}

/** For tests and the Continue card. */
export const hasRestoredSession = () => needsLoad && !!currentTrack();
