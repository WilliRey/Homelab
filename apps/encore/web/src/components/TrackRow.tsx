import { clock } from '../lib/format';
import { currentTrack, usePlayer } from '../player/store';
import type { VideoItem } from '../types';
import { MoreIcon } from './Icons';
import { openTrackMenu } from './TrackMenu';

type Props = {
  item: VideoItem;
  onPlay: () => void;
  /** Extra controls on the right (e.g. reorder buttons in a local playlist). */
  trailing?: React.ReactNode;
  menuExtra?: Parameters<typeof openTrackMenu>[1];
};

export function TrackRow({ item, onPlay, trailing, menuExtra }: Props) {
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === item.id);
  const meta = [item.channelName, item.kind === 'song' ? undefined : item.publishedText, clock(item.durationSec)].filter(Boolean).join(' · ');
  const square = item.kind === 'song';
  return (
    <li className="flex items-center gap-1" data-testid="track-row">
      <button
        type="button"
        onClick={onPlay}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1.5 text-left active:bg-raised"
      >
        <img
          src={item.thumbnail}
          alt=""
          loading="lazy"
          className={`shrink-0 rounded-md bg-raised object-cover ${square ? 'h-12 w-12' : 'h-12 w-[85px]'}`}
        />
        <span className="min-w-0 flex-1">
          <span className={`line-clamp-2 text-[15px] leading-snug ${isCurrent ? 'text-accent' : ''}`}>{item.title}</span>
          <span className="block truncate text-xs text-muted">{meta}</span>
        </span>
      </button>
      {trailing}
      <button
        type="button"
        aria-label={`More options for ${item.title}`}
        onClick={() => openTrackMenu(item, menuExtra)}
        className="tap flex shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
      >
        <MoreIcon size={20} />
      </button>
    </li>
  );
}
