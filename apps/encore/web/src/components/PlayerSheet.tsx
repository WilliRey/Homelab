// Full-screen player. Swipe down (or tap the chevron) to close.
import { useEffect, useRef, useState } from 'react';
import { cycleRepeat, next, previous, setRadio, setShuffle, togglePlay } from '../player/engine';
import { currentTrack, usePlayer } from '../player/store';
import { ChevronDownIcon, MoreIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, RadioIcon, RepeatIcon, ShuffleIcon } from './Icons';
import { QueueList } from './QueueList';
import { SeekBar } from './SeekBar';
import { openTrackMenu } from './TrackMenu';

const CLOSE_DISTANCE = 110;

export function PlayerSheet() {
  const open = usePlayer((s) => s.sheetOpen);
  const t = usePlayer((s) => currentTrack(s));
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const radio = usePlayer((s) => s.radio);
  const scroller = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const dragRef = useRef(0); // latest distance; state can lag behind fast touch events

  const close = () => usePlayer.setState({ sheetOpen: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open || !t) return null;

  // Swipe down: only when the sheet's content is scrolled to the top.
  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = (scroller.current?.scrollTop ?? 0) <= 0 ? e.touches[0]!.clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = Math.max(0, e.touches[0]!.clientY - startY.current);
    dragRef.current = dy;
    setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragRef.current > CLOSE_DISTANCE) close();
    dragRef.current = 0;
    setDragY(0);
    startY.current = null;
  };

  const art = t.artwork ?? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`;
  const ctl = 'tap flex items-center justify-center rounded-full active:bg-raised';
  const toggleCls = (on: boolean) => `${ctl} ${on ? 'text-accent' : 'text-muted'}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      data-testid="player-sheet"
      className="fixed inset-0 z-40 flex h-dvh flex-col bg-bg pl-safe pr-safe pt-safe"
      style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? 'none' : 'transform 200ms ease-out' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <header className="flex items-center justify-between px-2 py-1">
        <button type="button" aria-label="Close player" onClick={close} className={ctl}>
          <ChevronDownIcon />
        </button>
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Now playing</span>
        <button type="button" aria-label="More options" onClick={() => openTrackMenu(t)} className={ctl}>
          <MoreIcon />
        </button>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain px-6 pb-safe">
        <div id="player-media" className="mx-auto mt-2 aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-raised shadow-xl">
          <img src={art} alt="" className="h-full w-full object-cover" />
        </div>

        <div className="mx-auto mt-6 max-w-sm">
          <h2 className="line-clamp-2 text-xl font-semibold leading-tight">{t.title}</h2>
          <p className="mt-1 truncate text-muted">{t.channelName}</p>

          <div className="mt-4">
            <SeekBar />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <button type="button" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)} className={toggleCls(shuffle)}>
              <ShuffleIcon size={20} />
            </button>
            <button type="button" aria-label="Previous" onClick={previous} className={ctl}>
              <PrevIcon size={30} />
            </button>
            <button
              type="button"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={togglePlay}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-fg text-bg active:opacity-80"
            >
              {playing ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
            </button>
            <button type="button" aria-label="Next" onClick={next} className={ctl}>
              <NextIcon size={30} />
            </button>
            <button type="button" aria-label={`Repeat: ${repeat}`} onClick={cycleRepeat} className={`${toggleCls(repeat !== 'off')} relative`}>
              <RepeatIcon size={20} />
              {repeat === 'one' && <span className="absolute right-2 top-2 text-[9px] font-bold">1</span>}
            </button>
          </div>

          <div className="mt-3 flex justify-center">
            <button
              type="button"
              aria-pressed={radio}
              onClick={() => setRadio(!radio)}
              className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${radio ? 'border-accent text-accent' : 'border-line text-muted'}`}
            >
              <RadioIcon size={18} /> Radio {radio ? 'on' : 'off'}
            </button>
          </div>

          <div className="mt-6 pb-8">
            <QueueList />
          </div>
        </div>
      </div>
    </div>
  );
}
