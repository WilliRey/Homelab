CREATE TABLE subscriptions (channel_id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, added_at INTEGER NOT NULL);
CREATE TABLE feed_videos (video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL,
  published_at INTEGER, published_text TEXT, duration_sec INTEGER, thumbnail TEXT, first_seen_at INTEGER NOT NULL);
CREATE INDEX feed_videos_pub ON feed_videos(published_at DESC);
CREATE TABLE saved (video_id TEXT PRIMARY KEY, title TEXT, channel_id TEXT, channel_name TEXT,
  duration_sec INTEGER, thumbnail TEXT, kind TEXT, saved_at INTEGER NOT NULL);
CREATE TABLE playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE playlist_items (playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, video_id TEXT NOT NULL, title TEXT, channel_name TEXT, duration_sec INTEGER,
  thumbnail TEXT, PRIMARY KEY (playlist_id, position));
CREATE TABLE history (id INTEGER PRIMARY KEY, video_id TEXT NOT NULL, title TEXT, channel_name TEXT,
  thumbnail TEXT, duration_sec INTEGER, played_at INTEGER NOT NULL);
CREATE TABLE shorts_check (video_id TEXT PRIMARY KEY, is_short INTEGER NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE audio_cache (video_id TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER NOT NULL,
  mime TEXT NOT NULL, last_access INTEGER NOT NULL);
