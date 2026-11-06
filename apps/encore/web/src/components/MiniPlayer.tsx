import { next, togglePlay } from '../player/engine';
import { currentTrack, usePlayer } from '../player/store';
import { NextIcon, PauseIcon, PlayIcon } from './Icons';

export function MiniPlayer() {
  const t = usePlayer((s) => currentTrack(s));
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const pct = usePlayer((s) => (s.duration > 0 ? (s.currentTime / s.duration) * 100 : 0));
  if (!t) return null;
  return (
    <div className="relative mx-2 mb-1 overflow-hidden rounded-xl bg-raised shadow-lg" data-testid="mini-player">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 p-2 text-left"
          aria-label="Open player"
          onClick={() => usePlayer.setState({ sheetOpen: true })}
        >
          <img src={t.artwork ?? t.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t.title}</span>
            <span className="block truncate text-xs text-muted">{buffering && playing ? 'Loading…' : t.channelName}</span>
          </span>
        </button>
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay} className="tap flex items-center justify-center rounded-full active:bg-line">
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" aria-label="Next" onClick={next} className="tap flex items-center justify-center rounded-full active:bg-line">
          <NextIcon />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
