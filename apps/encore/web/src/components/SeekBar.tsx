import { useState } from 'react';
import { clock } from '../lib/format';
import { seek } from '../player/engine';
import { usePlayer } from '../player/store';

export function SeekBar() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? currentTime;
  const max = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const pct = max ? (shown / max) * 100 : 0;
  return (
    <div>
      <input
        type="range"
        className="seek"
        aria-label="Seek"
        min={0}
        max={max || 1}
        step={0.5}
        value={Math.min(shown, max || 1)}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onTouchEnd={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
      />
      <div className="-mt-2 flex justify-between text-xs tabular-nums text-muted">
        <span>{clock(shown)}</span>
        <span>{max ? clock(max) : '--:--'}</span>
      </div>
    </div>
  );
}
