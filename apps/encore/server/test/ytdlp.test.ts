import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildArgs, classifyFailure, expiryOf, isValidVideoId, selectAudio, selectVideo, type YtdlpInfo } from '../src/yt/ytdlp.js';

// Real `yt-dlp -J` output (2026-11-06) with URLs redacted.
const info = JSON.parse(readFileSync(new URL('./fixtures/ytdlp-dQw4w9WgXcQ.json', import.meta.url), 'utf8')) as YtdlpInfo;

describe('format selection', () => {
  it('picks the highest-bitrate AAC audio-only format (itag 140)', () => {
    const a = selectAudio(info)!;
    expect(a.itag).toBe('140');
    expect(a.mime).toBe('audio/mp4');
    expect(a.size).toBe(3449447);
    expect(a.headers['User-Agent']).toBeTruthy();
    expect(a.expiresAt).toBe(1800000000 * 1000);
  });

  it('never picks opus/webm or muxed formats for audio', () => {
    const onlyOpus: YtdlpInfo = { ...info, formats: info.formats!.filter((f) => f.acodec === 'opus' || f.format_id === '18') };
    expect(selectAudio(onlyOpus)).toBeNull();
  });

  it('picks the highest avc1 video-only format at or below the requested height', () => {
    expect(selectVideo(info, 480)!.itag).toBe('135');
    expect(selectVideo(info, 720)!.itag).toBe('136');
    expect(selectVideo(info, 360)!.itag).toBe('134');
    expect(selectVideo(info, 500)!.height).toBe(480);
    expect(selectVideo(info, 720)!.mime).toBe('video/mp4');
  });

  it('falls back to the lowest avc1 height when nothing is small enough', () => {
    expect(selectVideo(info, 100)!.itag).toBe('160');
  });

  it('ignores non-https protocols', () => {
    const hls: YtdlpInfo = { ...info, formats: info.formats!.map((f) => ({ ...f, protocol: 'm3u8_native' })) };
    expect(selectAudio(hls)).toBeNull();
    expect(selectVideo(hls, 480)).toBeNull();
  });
});

describe('yt-dlp invocation', () => {
  it('validates ids', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidVideoId('dQw4w9WgXc')).toBe(false);
    expect(isValidVideoId('--exec=rm -rf')).toBe(false);
    expect(isValidVideoId('dQw4w9WgXc;')).toBe(false);
  });

  it('builds an argument array with the POT provider and an end-of-options marker', () => {
    const args = buildArgs('dQw4w9WgXcQ', { potProviderUrl: 'http://bgutil:4416', cookiesFile: '/data/cookies.txt' });
    expect(args).toEqual([
      '-J', '--no-playlist', '--no-warnings',
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://bgutil:4416',
      '--cookies', '/data/cookies.txt',
      '--', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]);
  });

  it('recognises the bot check', () => {
    const e = classifyFailure("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies…", false);
    expect(e.kind).toBe('bot-check');
    expect(classifyFailure('', true).kind).toBe('timeout');
    expect(classifyFailure('ERROR: [youtube] x: Video unavailable', false).kind).toBe('unavailable');
  });

  it('reads expire= from the URL, with a fallback', () => {
    expect(expiryOf('https://x/videoplayback?expire=1700000000')).toBe(1700000000000);
    expect(expiryOf('https://x/videoplayback', 1000)).toBe(1000 + 5 * 3600 * 1000);
  });
});
