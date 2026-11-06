export function clock(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const looksLikeUrl = (s: string) => /^(https?:\/\/)?([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(s.trim());

/** Video id from a watch/youtu.be/music link, parsed synchronously so a tap can play it at once. */
export function videoIdFromUrl(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (u.pathname.startsWith('/shorts/')) return null; // the server refuses these
    const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
    if (host === 'youtu.be') return ok(u.pathname.slice(1).split('/')[0]);
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return ok(u.searchParams.get('v'));
      const m = /^\/(?:live|embed)\/([^/?]+)/.exec(u.pathname);
      if (m) return ok(m[1]);
    }
  } catch {
    /* not a URL */
  }
  return null;
}
