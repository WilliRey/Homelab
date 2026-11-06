import { describe, expect, it } from 'vitest';
import { migrate, openDb } from '../src/db/index.js';

describe('migrations', () => {
  it('creates the schema once and is idempotent', () => {
    const db = openDb('/tmp', ':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['subscriptions', 'feed_videos', 'saved', 'playlists', 'playlist_items', 'history', 'shorts_check', 'audio_cache', 'schema_version']));
    expect(migrate(db)).toBe(1);
  });
});
