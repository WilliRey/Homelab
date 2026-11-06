import { clock } from '../lib/format';
import { togglePlay } from '../player/engine';
import { currentTrack, usePlayer } from '../player/store';
import { PlayIcon } from './Icons';

/** Shown when a session was restored paused: one tap resumes where you left off. */
export function ContinueCard() {
  const t = usePlayer((s) => currentTrack(s));
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.currentTime);
  if (!t || playing) return null;
  return (
    <div className="px-4 pt-2">
      <button type="button" onClick={togglePlay} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left active:bg-raised" data-testid="continue-card">
        <img src={t.artwork ?? t.thumbnail} alt="" className="h-14 w-14 rounded-lg object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs uppercase tracking-wider text-accent">Continue</span>
          <span className="block truncate font-medium">{t.title}</span>
          <span className="block truncate text-xs text-muted">{[t.channelName, time > 0 ? `at ${clock(time)}` : undefined].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg">
          <PlayIcon size={20} />
        </span>
      </button>
    </div>
  );
}
