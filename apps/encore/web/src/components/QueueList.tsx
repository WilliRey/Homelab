import { clock } from '../lib/format';
import { playIndex, removeFromQueue } from '../player/engine';
import { usePlayer } from '../player/store';
import { CloseIcon } from './Icons';

export function QueueList() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const radioLoading = usePlayer((s) => s.radioLoading);
  const upNext = queue.slice(index + 1);
  return (
    <section aria-label="Queue" data-testid="queue">
      <h3 className="px-1 pb-2 text-sm font-semibold text-muted">Up next {upNext.length ? `· ${upNext.length}` : ''}</h3>
      {!upNext.length && <p className="px-1 py-2 text-sm text-muted">{radioLoading ? 'Finding more like this…' : 'Nothing queued.'}</p>}
      <ol>
        {upNext.map((t, k) => {
          const i = index + 1 + k;
          return (
            <li key={`${t.id}-${i}`} className="flex items-center">
              <button type="button" onClick={() => playIndex(i)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left active:bg-raised">
                <img src={t.thumbnail} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.title}</span>
                  <span className="block truncate text-xs text-muted">{[t.channelName, clock(t.durationSec)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <button type="button" aria-label={`Remove ${t.title}`} onClick={() => removeFromQueue(i)} className="tap flex items-center justify-center text-muted">
                <CloseIcon size={18} />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
