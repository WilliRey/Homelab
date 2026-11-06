// Lock-screen / notification / headphone controls (PLAN.md section 5, "Media Session").
import type { VideoItem } from '../types';

const ms = (): MediaSession | null => ('mediaSession' in navigator ? navigator.mediaSession : null);

export type SessionHandlers = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  previous: () => void;
  next: () => void;
  seekTo: (t: number) => void;
};

export function registerHandlers(h: SessionHandlers): void {
  const s = ms();
  if (!s) return;
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      s.setActionHandler(action, fn);
    } catch {
      /* action unsupported on this browser */
    }
  };
  set('play', () => h.play());
  set('pause', () => h.pause());
  set('stop', () => h.stop());
  set('previoustrack', () => h.previous());
  set('nexttrack', () => h.next());
  set('seekto', (d) => {
    if (typeof d.seekTime === 'number') h.seekTo(d.seekTime);
  });
  // Deliberately NOT registered: seekbackward / seekforward. On iOS they replace the
  // lock screen's previous/next buttons with ±10 s.
  set('seekbackward', null);
  set('seekforward', null);
}

export function setMetadata(t: VideoItem | undefined): void {
  const s = ms();
  if (!s || typeof MediaMetadata === 'undefined') return;
  if (!t) {
    s.metadata = null;
    return;
  }
  const artwork =
    t.kind === 'song' && t.artwork && !t.artwork.includes('/vi/')
      ? [{ src: t.artwork, sizes: '544x544', type: 'image/jpeg' }]
      : [{ src: `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }];
  s.metadata = new MediaMetadata({ title: t.title, artist: t.channelName ?? '', album: 'Encore', artwork });
}

export function setPlaybackState(state: MediaSessionPlaybackState): void {
  const s = ms();
  if (s) s.playbackState = state;
}

/** Call on loadedmetadata, play, pause, seeked and ratechange — not on every timeupdate. */
export function setPosition(audio: HTMLAudioElement): void {
  const s = ms();
  if (!s?.setPositionState) return;
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    s.setPositionState({
      duration,
      position: Math.min(Math.max(0, audio.currentTime), duration),
      playbackRate: audio.playbackRate || 1,
    });
  } catch {
    /* position out of range during a source change */
  }
}
