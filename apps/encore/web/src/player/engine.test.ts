import { describe, expect, it } from 'vitest';
import { videoIdFromUrl } from '../lib/format';
import { nextIndex } from './engine';
import type { PlayerState } from './store';

const s = (index: number, len: number, repeat: PlayerState['repeat'] = 'off') =>
  ({ index, queue: Array.from({ length: len }, (_, i) => ({ id: `v${i}` })), repeat }) as unknown as PlayerState;

describe('nextIndex', () => {
  it('advances, stops at the end, wraps with repeat all', () => {
    expect(nextIndex(s(0, 3), true)).toBe(1);
    expect(nextIndex(s(2, 3), true)).toBe(-1);
    expect(nextIndex(s(2, 3, 'all'), true)).toBe(0);
  });
  it('repeat one replays only when the track ends by itself', () => {
    expect(nextIndex(s(1, 3, 'one'), true)).toBe(1);
    expect(nextIndex(s(1, 3, 'one'), false)).toBe(2);
  });
});

describe('videoIdFromUrl', () => {
  it('parses video links and refuses shorts', () => {
    expect(videoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?si=x')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromUrl('music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toBeNull();
    expect(videoIdFromUrl('https://www.youtube.com/playlist?list=PL1')).toBeNull();
  });
});
