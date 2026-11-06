// ADAPTER: every youtubei.js call lives here, nowhere else.
//
// Written against youtubei.js 18.3.0. Notes on where that version differs from the plan:
//  - Channel Videos/Playlists tabs and playlists now return `LockupView` nodes
//    (content_type VIDEO / PLAYLIST / SHORT) instead of Video/GridVideo/PlaylistVideo.
//    Both shapes are handled.
//  - Search results put Shorts in `GridShelfView` shelves of `ShortsLockupView`.
//  - `Channel` search nodes carry the @handle in `subscriber_count` and the subscriber
//    count in `video_count`; we pick whichever text mentions "subscriber".
//  - Continuations are methods on the result object, not tokens, so we keep result
//    objects in a short-lived in-memory map and hand out opaque ids as `next`.
//  - getBasicInfo has no related feed; getVideo() uses getInfo() for that (no stream
//    deciphering happens: the session is created with retrieve_player: false).
import { randomUUID } from 'node:crypto';
import { Innertube, UniversalCache } from 'youtubei.js';
import { isShortsNodeType, isShortsShelfTitle, isShortsUrl } from './shorts.js';
import { parseClock, parseRelativeTime } from './time.js';
import {
  bigThumb,
  listThumb,
  YtError,
  type ChannelItem,
  type ChannelPage,
  type Page,
  type PlaylistItem,
  type PlaylistPage,
  type ResolvedUrl,
  type VideoDetails,
  type VideoItem,
} from './types.js';

type Any = any; // youtubei.js node shapes vary by surface; we duck-type them below.

// ---------------------------------------------------------------------------
// Session

let session: Promise<Innertube> | null = null;

function yt(): Promise<Innertube> {
  if (!session) {
    session = Innertube.create({ retrieve_player: false, cache: new UniversalCache(false) }).catch((err) => {
      session = null; // retry on the next call
      throw err;
    });
  }
  return session;
}

/** Run a youtubei.js call and translate its errors. */
async function call<T>(what: string, fn: (yt: Innertube) => Promise<T>): Promise<T> {
  try {
    return await fn(await yt());
  } catch (err) {
    if (err instanceof YtError) throw err;
    const msg = String((err as Error)?.message ?? err);
    if (/status code 429|status code 403|automated queries/i.test(msg)) throw new YtError('rate-limited', `${what}: YouTube is rate-limiting this server`);
    if (/not found|does not exist|unavailable|status code 404/i.test(msg)) throw new YtError('unavailable', `${what}: not found`);
    throw new YtError('failed', `${what}: ${msg.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Continuations: opaque ids → live result objects (30 min, at most 500)

const CONT_TTL_MS = 30 * 60 * 1000;
const CONT_MAX = 500;
const continuations = new Map<string, { kind: string; obj: Any; exp: number }>();

function stash(kind: string, obj: Any): string {
  const now = Date.now();
  for (const [k, v] of continuations) if (v.exp < now || continuations.size >= CONT_MAX) continuations.delete(k);
  const id = randomUUID();
  continuations.set(id, { kind, obj, exp: now + CONT_TTL_MS });
  return id;
}

function unstash(kind: string, token: string): Any {
  const hit = continuations.get(token);
  if (!hit || hit.kind !== kind || hit.exp < Date.now()) throw new YtError('unavailable', 'continuation expired; reload the list');
  return hit.obj;
}

// ---------------------------------------------------------------------------
// Normalization helpers

const str = (t: Any): string | undefined => {
  if (t === undefined || t === null) return undefined;
  const s = typeof t === 'string' ? t : typeof t.toString === 'function' ? t.toString() : undefined;
  return s && s !== '[object Object]' && s !== 'N/A' ? s.trim() : undefined;
};

const https = (u: string | undefined) => (u?.startsWith('//') ? `https:${u}` : u);

const isVideoId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);

const endpointUrl = (n: Any): string | undefined =>
  n?.endpoint?.metadata?.url ??
  n?.on_tap_endpoint?.metadata?.url ??
  n?.renderer_context?.command_context?.on_tap?.metadata?.url ??
  n?.navigation_endpoint?.metadata?.url;

/** Collect short strings under an object (bounded), for badge/overlay text. */
function texts(obj: Any, depth = 6, out: string[] = []): string[] {
  if (!obj || depth < 0 || out.length > 50) return out;
  if (typeof obj === 'string') {
    if (obj.length < 80) out.push(obj);
    return out;
  }
  if (typeof obj !== 'object') return out;
  if (typeof obj.text === 'string') out.push(obj.text);
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) if (typeof v === 'object' || typeof v === 'string') texts(v, depth - 1, out);
  return out;
}

const countFrom = (obj: Any): number | undefined => {
  for (const t of texts(obj)) {
    const m = /(\d[\d,.]*)\s+(videos?|episodes?|songs?|tracks?)\b/i.exec(t);
    if (m) return Number(m[1]!.replace(/[,.]/g, ''));
  }
  return undefined;
};

function videoFromClassic(n: Any, kind: VideoItem['kind'] = 'video'): VideoItem | null {
  const id = n.video_id ?? n.id;
  if (!isVideoId(id) || isShortsUrl(endpointUrl(n))) return null;
  const title = str(n.title);
  if (!title) return null;
  const published = str(n.published);
  const seconds = n.duration?.seconds ?? parseClock(str(n.length_text) ?? str(n.duration?.text));
  return {
    id,
    title,
    channelId: n.author?.id ?? n.author?.channel_id ?? n.artists?.[0]?.channel_id,
    channelName: str(n.author?.name) ?? (typeof n.author === 'string' ? n.author : undefined) ?? n.artists?.[0]?.name,
    durationSec: seconds && seconds > 0 ? seconds : undefined,
    publishedText: published,
    publishedAt: parseRelativeTime(published),
    views: str(n.short_view_count) ?? str(n.view_count),
    thumbnail: listThumb(id),
    artwork: bigThumb(id),
    kind,
  };
}

function lockupRows(n: Any): Array<Array<{ text?: string; browseId?: string }>> {
  const rows: Any[] = n.metadata?.metadata?.metadata_rows ?? [];
  return rows.map((r) =>
    (r.metadata_parts ?? []).map((p: Any) => ({
      text: str(p.text),
      browseId: p.text?.runs?.map((x: Any) => x.endpoint?.payload?.browseId).find(Boolean),
    })),
  );
}

function videoFromLockup(n: Any): VideoItem | null {
  const id = n.content_id;
  if (!isVideoId(id) || isShortsUrl(endpointUrl(n))) return null;
  const title = str(n.metadata?.title);
  if (!title) return null;
  const rows = lockupRows(n).flat();
  const channel = rows.find((p) => p.browseId?.startsWith('UC'));
  const rest = rows.filter((p) => p !== channel).map((p) => p.text ?? '');
  const published = rest.find((t) => /ago\b/i.test(t));
  const views = rest.find((t) => /views?$|^\d[\d.,]*[KMB]?$/i.test(t));
  const seconds = n.duration?.seconds;
  return {
    id,
    title,
    channelId: channel?.browseId,
    channelName: channel?.text,
    durationSec: seconds && seconds > 0 ? seconds : undefined,
    publishedText: published,
    publishedAt: parseRelativeTime(published),
    views,
    thumbnail: listThumb(id),
    artwork: bigThumb(id),
    kind: 'video',
  };
}

function playlistFromLockup(n: Any): PlaylistItem | null {
  const id = n.content_id;
  const title = str(n.metadata?.title);
  if (!id || !title) return null;
  const owner = lockupRows(n).flat()[0]?.text;
  const img = n.content_image?.primary_thumbnail?.image?.[0]?.url ?? n.content_image?.image?.[0]?.url;
  return { id, title, thumbnail: https(img), count: countFrom(n.content_image), owner };
}

function playlistFromClassic(n: Any): PlaylistItem | null {
  const id = n.id ?? n.playlist_id;
  const title = str(n.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    thumbnail: https(n.thumbnails?.[0]?.url ?? n.thumbnail?.[0]?.url),
    count: countFrom([str(n.video_count), str(n.video_count_short)]),
    owner: str(n.author?.name),
  };
}

function channelFromNode(n: Any): ChannelItem | null {
  const id = n.author?.id ?? n.id;
  const name = str(n.author?.name) ?? str(n.title);
  if (typeof id !== 'string' || !id.startsWith('UC') || !name) return null;
  const subs = [str(n.subscriber_count), str(n.video_count)].find((t) => t && /subscriber/i.test(t));
  return { id, name, avatar: https(n.author?.thumbnails?.[0]?.url ?? n.thumbnails?.[0]?.url), subscribers: subs };
}

function songFromMusic(n: Any): VideoItem | null {
  const id = n.id ?? n.video_id;
  if (!isVideoId(id)) return null;
  const title = str(n.title);
  if (!title) return null;
  const thumbs: Any[] = n.thumbnail?.contents ?? n.thumbnails ?? (Array.isArray(n.thumbnail) ? n.thumbnail : []);
  const art = thumbs.length ? https(thumbs[thumbs.length - 1]?.url) : undefined;
  const artist = n.artists?.[0] ?? n.authors?.[0] ?? n.author;
  return {
    id,
    title,
    channelId: artist?.channel_id,
    channelName: str(artist?.name) ?? (typeof n.author === 'string' ? n.author : undefined),
    durationSec: n.duration?.seconds || undefined,
    thumbnail: listThumb(id),
    artwork: art ?? bigThumb(id),
    kind: n.item_type === 'video' ? 'video' : 'song',
  };
}

type Normalized = { videos: VideoItem[]; channels: ChannelItem[]; playlists: PlaylistItem[] };

const SHELF_TYPES = new Set([
  'Shelf', 'RichShelf', 'GridShelfView', 'ItemSection', 'HorizontalCardList', 'VerticalList',
  'SectionList', 'HorizontalList', 'ExpandedShelfContents', 'RichSection', 'RichItem', 'MusicShelf',
  'MusicCarouselShelf', 'PlaylistPanel', 'Grid', 'ContinuationItem',
]);

/**
 * Shorts rule 1: walk result nodes, keeping only regular videos (Video, CompactVideo,
 * PlaylistVideo, VIDEO lockups…) and dropping Shorts node types and Shorts shelves.
 */
export function normalizeNodes(nodes: Any[] | undefined, out: Normalized = { videos: [], channels: [], playlists: [] }, depth = 0): Normalized {
  if (!nodes || depth > 4) return out;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const type: string | undefined = n.type;
    if (isShortsNodeType(type)) continue;
    switch (type) {
      case 'Video':
      case 'CompactVideo':
      case 'GridVideo':
      case 'PlaylistVideo':
      case 'ReelItem' /* unreachable: filtered above */: {
        const v = videoFromClassic(n);
        if (v) out.videos.push(v);
        break;
      }
      case 'PlaylistPanelVideo': {
        // YouTube Music up-next: songs or music videos, never Shorts.
        const v = songFromMusic({ ...n, id: n.video_id, thumbnails: n.thumbnail });
        if (v) out.videos.push({ ...v, kind: 'song' });
        break;
      }
      case 'MusicResponsiveListItem':
      case 'MusicTwoRowItem': {
        if (n.item_type === 'song' || n.item_type === 'video') {
          const v = songFromMusic(n);
          if (v) out.videos.push(v);
        }
        break;
      }
      case 'LockupView': {
        if (n.content_type === 'VIDEO') {
          const v = videoFromLockup(n);
          if (v) out.videos.push(v);
        } else if (n.content_type === 'PLAYLIST' || n.content_type === 'ALBUM') {
          const p = playlistFromLockup(n);
          if (p) out.playlists.push(p);
        }
        // SHORT and everything else: dropped.
        break;
      }
      case 'Channel':
      case 'GridChannel': {
        const c = channelFromNode(n);
        if (c) out.channels.push(c);
        break;
      }
      case 'Playlist':
      case 'GridPlaylist':
      case 'CompactPlaylist': {
        const p = playlistFromClassic(n);
        if (p) out.playlists.push(p);
        break;
      }
      default: {
        const title = str(n.title) ?? str(n.header?.title) ?? str(n.header?.title?.text);
        if (isShortsShelfTitle(title)) continue;
        if (type && !SHELF_TYPES.has(type)) continue;
        const inner = n.contents ?? n.items ?? n.content?.items ?? (n.content ? [n.content] : undefined);
        normalizeNodes(Array.isArray(inner) ? inner : inner ? [inner] : undefined, out, depth + 1);
      }
    }
  }
  return out;
}

const dedupe = <T extends { id: string }>(xs: T[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
};

// ---------------------------------------------------------------------------
// Public API

export type SearchType = 'songs' | 'videos' | 'channels' | 'playlists';
const SEARCH_FILTER = { videos: 'video', channels: 'channel', playlists: 'playlist' } as const;

export async function search(q: string, type: Exclude<SearchType, 'songs'>, next?: string): Promise<Page<VideoItem | ChannelItem | PlaylistItem>> {
  return call('search', async (y) => {
    const res: Any = next ? await unstash(`search:${type}`, next).getContinuation() : await y.search(q, { type: SEARCH_FILTER[type] });
    const n = normalizeNodes(res.results ?? res.contents);
    const items = type === 'videos' ? n.videos : type === 'channels' ? n.channels : n.playlists;
    return { items: dedupe<Any>(items), next: res.has_continuation ? stash(`search:${type}`, res) : undefined };
  });
}

/** YouTube Music song search. Falls back to regular video search when YT Music returns nothing. */
export async function searchSongs(q: string, next?: string): Promise<Page<VideoItem>> {
  return call('music search', async (y) => {
    if (next) {
      const hit = continuations.get(next);
      if (hit?.kind === 'search:videos') return search(q, 'videos', next) as Promise<Page<VideoItem>>;
      const res: Any = await unstash('music:songs', next).getContinuation();
      const items = normalizeNodes(res.contents?.contents ?? res.contents).videos;
      return { items: dedupe(items), next: res.has_continuation ? stash('music:songs', res) : undefined };
    }
    const res: Any = await y.music.search(q, { type: 'song' });
    const shelf = res.songs ?? res.contents?.find((c: Any) => c.type === 'MusicShelf');
    const items = normalizeNodes(shelf?.contents ?? []).videos;
    if (items.length === 0) {
      // Adaptation: YT Music sometimes answers "No results" (seen from datacenter IPs).
      // Regular search is a better answer than nothing; these items get the Shorts check.
      return search(q, 'videos') as Promise<Page<VideoItem>>;
    }
    return { items: dedupe(items), next: res.has_continuation ? stash('music:songs', res) : undefined };
  });
}

export async function suggestions(q: string): Promise<string[]> {
  return call('suggest', (y) => y.getSearchSuggestions(q));
}

export async function getVideo(id: string): Promise<VideoDetails> {
  return call('video', async (y) => {
    const info: Any = await y.getInfo(id);
    const b = info.basic_info ?? {};
    const isLive = !!b.is_live;
    const isUpcoming = !!b.is_upcoming;
    const related = normalizeNodes(info.watch_next_feed ?? []).videos.filter((v) => v.id !== id);
    const published = str(info.primary_info?.relative_date) ?? str(info.primary_info?.published);
    return {
      id,
      title: b.title ?? '',
      channelId: b.channel_id ?? b.channel?.id,
      channelName: b.author ?? b.channel?.name,
      durationSec: b.duration || undefined,
      publishedText: published,
      publishedAt: parseRelativeTime(published),
      views: b.view_count !== undefined ? String(b.view_count) : undefined,
      thumbnail: listThumb(id),
      artwork: bigThumb(id),
      kind: 'video',
      playable: !isLive && !isUpcoming,
      isLive,
      isUpcoming,
      description: b.short_description,
      related: dedupe(related),
    };
  });
}

/** Lightweight info for filling in feed durations. */
export async function getBasicInfo(id: string): Promise<{ durationSec?: number; isLive: boolean; isUpcoming: boolean; title?: string }> {
  return call('basic info', async (y) => {
    const b: Any = (await y.getBasicInfo(id)).basic_info ?? {};
    return { durationSec: b.duration || undefined, isLive: !!b.is_live, isUpcoming: !!b.is_upcoming, title: b.title };
  });
}

/** Shorts rule 4: only the Videos and Playlists tabs are ever requested. */
export type ChannelTab = 'videos' | 'playlists';

export async function getChannel(id: string, tab: ChannelTab, next?: string): Promise<{ channel: ChannelPage; page: Page<VideoItem | PlaylistItem> }> {
  return call('channel', async (y) => {
    if (next) {
      const { channel, res } = unstash(`channel:${tab}`, next) as { channel: ChannelPage; res: Any };
      const cont: Any = await res.getContinuation();
      return { channel, page: channelPage(tab, channel, cont) };
    }
    const ch: Any = await y.getChannel(id);
    const md = ch.metadata ?? {};
    const header = ch.header ?? {};
    const channel: ChannelPage = {
      id: md.external_id ?? id,
      name: md.title ?? str(header.title) ?? '',
      avatar: https(md.avatar?.[0]?.url ?? md.thumbnail?.[0]?.url),
      handle: md.vanity_channel_url?.split('/').pop(),
      subscribers: texts(header).find((t) => /subscriber/i.test(t)),
    };
    const hasTab = tab === 'videos' ? ch.has_videos !== false : ch.has_playlists !== false;
    if (!hasTab) return { channel, page: { items: [] } };
    const res: Any = tab === 'videos' ? await ch.getVideos() : await ch.getPlaylists();
    return { channel, page: channelPage(tab, channel, res) };
  });
}

function channelPage(tab: ChannelTab, channel: ChannelPage, res: Any): Page<VideoItem | PlaylistItem> {
  const nodes = tab === 'videos' ? res.videos ?? res.contents : res.playlists ?? res.contents;
  const n = normalizeNodes(Array.isArray(nodes) ? nodes : [nodes]);
  const items =
    tab === 'videos'
      ? n.videos.map((v) => ({ ...v, channelId: v.channelId ?? channel.id, channelName: v.channelName ?? channel.name }))
      : n.playlists.map((p) => ({ ...p, owner: p.owner ?? channel.name }));
  return { items: dedupe<Any>(items), next: res.has_continuation ? stash(`channel:${tab}`, { channel, res }) : undefined };
}

/** First page of a channel's Videos tab (feed fallback). */
export async function getChannelVideos(channelId: string): Promise<VideoItem[]> {
  return (await getChannel(channelId, 'videos')).page.items as VideoItem[];
}

export async function getPlaylist(id: string, next?: string): Promise<PlaylistPage> {
  return call('playlist', async (y) => {
    const pl: Any = next ? await unstash('playlist', next).pl.getContinuation() : await y.getPlaylist(id);
    const base: PlaylistItem = next
      ? unstash('playlist', next).base
      : {
          id,
          title: str(pl.info?.title) ?? '',
          thumbnail: https(pl.info?.thumbnails?.[0]?.url),
          count: countFrom([str(pl.info?.total_items)]),
          owner: str(pl.info?.author?.name),
        };
    const items = normalizeNodes(pl.items ?? pl.videos ?? []).videos;
    return { ...base, items: dedupe(items), next: pl.has_continuation ? stash('playlist', { pl, base }) : undefined };
  });
}

/** YouTube Music up-next / automix for radio autoplay. */
export async function upNext(id: string): Promise<VideoItem[]> {
  return call('up next', async (y) => {
    const panel: Any = await y.music.getUpNext(id, true);
    return dedupe(normalizeNodes(panel.contents ?? []).videos.filter((v) => v.id !== id));
  });
}

export async function resolveUrl(url: string): Promise<ResolvedUrl | null> {
  return call('resolve', async (y) => {
    const ep: Any = await y.resolveURL(url);
    const p = ep?.payload ?? {};
    const page: string | undefined = ep?.metadata?.page_type;
    if (page === 'WEB_PAGE_TYPE_SHORTS') return null; // caller rejects; never returned as a video
    if (isVideoId(p.videoId)) return { type: 'video', id: p.videoId, playlistId: p.playlistId };
    if (typeof p.browseId === 'string') {
      if (p.browseId.startsWith('VL')) return { type: 'playlist', id: p.browseId.slice(2) };
      if (p.browseId.startsWith('UC')) return { type: 'channel', id: p.browseId };
      if (p.browseId.startsWith('MPRE')) return { type: 'playlist', id: p.browseId }; // album
    }
    // youtu.be links come back as a plain web URL to /watch
    if (typeof p.url === 'string') {
      try {
        const u = new URL(p.url);
        const v = u.searchParams.get('v');
        if (isVideoId(v)) return { type: 'video', id: v };
      } catch {
        /* fall through */
      }
    }
    return null;
  });
}
