// Normalized types. Only innertube.ts and ytdlp.ts know about third-party YouTube shapes.

export type VideoItem = {
  id: string;               // 11-char video id
  title: string;
  channelId?: string;
  channelName?: string;
  durationSec?: number;
  publishedAt?: number;     // epoch ms, when known
  publishedText?: string;   // "2 days ago" when that's all we have
  views?: string;
  thumbnail: string;        // https://i.ytimg.com/vi/<id>/mqdefault.jpg for lists
  artwork?: string;         // square art for songs (YT Music), else hqdefault
  kind: 'video' | 'song';
};
export type ChannelItem  = { id: string; name: string; avatar?: string; subscribers?: string };
export type PlaylistItem = { id: string; title: string; thumbnail?: string; count?: number; owner?: string };
export type Page<T> = { items: T[]; next?: string };  // `next` = opaque continuation token

export type VideoDetails = VideoItem & {
  playable: boolean;
  isLive?: boolean;
  isUpcoming?: boolean;
  description?: string;
  related: VideoItem[];
};

export type ChannelPage = ChannelItem & { banner?: string; handle?: string };

export type PlaylistPage = PlaylistItem & { items: VideoItem[]; next?: string };

export type ResolvedUrl =
  | { type: 'video'; id: string; playlistId?: string }
  | { type: 'playlist'; id: string }
  | { type: 'channel'; id: string };

export const listThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const bigThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export type YtErrorKind = 'bot-check' | 'unavailable' | 'unplayable' | 'timeout' | 'rate-limited' | 'failed';

/** Errors from either adapter, already classified. Routes map `kind` to an HTTP status. */
export class YtError extends Error {
  constructor(readonly kind: YtErrorKind, message: string) {
    super(message);
    this.name = 'YtError';
  }
}
