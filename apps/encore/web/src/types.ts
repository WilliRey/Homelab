// Mirrors server/src/yt/types.ts.
export type VideoItem = {
  id: string;
  title: string;
  channelId?: string;
  channelName?: string;
  durationSec?: number;
  publishedAt?: number;
  publishedText?: string;
  views?: string;
  thumbnail: string;
  artwork?: string;
  kind: 'video' | 'song';
};
export type ChannelItem = { id: string; name: string; avatar?: string; subscribers?: string };
export type PlaylistItem = { id: string; title: string; thumbnail?: string; count?: number; owner?: string };
export type Page<T> = { items: T[]; next?: string };
export type LocalPlaylist = { id: number; name: string; count?: number; thumbnail?: string | null };
export type ResolvedUrl = { type: 'video'; id: string; playlistId?: string } | { type: 'playlist'; id: string } | { type: 'channel'; id: string };
