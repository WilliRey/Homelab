// Local library: saved ("liked") tracks, local playlists, play history.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../index.js';

const VideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const Track = z.object({
  id: VideoId,
  title: z.string().max(500).optional(),
  channelId: z.string().max(64).optional(),
  channelName: z.string().max(300).optional(),
  durationSec: z.number().int().nonnegative().optional(),
  thumbnail: z.string().max(1000).optional(),
  artwork: z.string().max(1000).optional(),
  kind: z.enum(['video', 'song']).optional(),
});
type Track = z.infer<typeof Track>;

const HISTORY_MAX = 500;
const thumbFor = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

type SavedRow = { video_id: string; title: string | null; channel_id: string | null; channel_name: string | null; duration_sec: number | null; thumbnail: string | null; kind: string | null; saved_at: number };
type ItemRow = { position: number; video_id: string; title: string | null; channel_name: string | null; duration_sec: number | null; thumbnail: string | null };

const savedToItem = (r: SavedRow) => ({
  id: r.video_id, title: r.title ?? '', channelId: r.channel_id ?? undefined, channelName: r.channel_name ?? undefined,
  durationSec: r.duration_sec ?? undefined, thumbnail: r.thumbnail ?? thumbFor(r.video_id), kind: (r.kind as 'video' | 'song') ?? 'video', savedAt: r.saved_at,
});
const rowToItem = (r: ItemRow) => ({
  id: r.video_id, title: r.title ?? '', channelName: r.channel_name ?? undefined, durationSec: r.duration_sec ?? undefined,
  thumbnail: r.thumbnail ?? thumbFor(r.video_id), kind: 'video' as const, position: r.position,
});

export const libraryRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  const { db } = deps;
  const bad = (reply: any, msg = 'invalid request') => reply.code(400).send({ error: msg });

  // ---- Saved ---------------------------------------------------------------
  app.get('/api/library/saved', async () => {
    const rows = db.prepare('SELECT * FROM saved ORDER BY saved_at DESC').all() as SavedRow[];
    return { items: rows.map(savedToItem) };
  });

  app.get<{ Params: { id: string } }>('/api/library/saved/:id', async (req) => ({
    saved: !!db.prepare('SELECT 1 FROM saved WHERE video_id = ?').get(req.params.id),
  }));

  app.put<{ Params: { id: string } }>('/api/library/saved/:id', async (req, reply) => {
    const t = Track.safeParse({ ...(req.body as object), id: req.params.id });
    if (!t.success) return bad(reply);
    const v = t.data;
    db.prepare(
      `INSERT INTO saved (video_id, title, channel_id, channel_name, duration_sec, thumbnail, kind, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET title=excluded.title, channel_id=excluded.channel_id,
         channel_name=excluded.channel_name, duration_sec=excluded.duration_sec, thumbnail=excluded.thumbnail, kind=excluded.kind`,
    ).run(v.id, v.title ?? null, v.channelId ?? null, v.channelName ?? null, v.durationSec ?? null, v.thumbnail ?? null, v.kind ?? 'video', Date.now());
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/library/saved/:id', async (req) => {
    db.prepare('DELETE FROM saved WHERE video_id = ?').run(req.params.id);
    return { ok: true };
  });

  // ---- Local playlists -----------------------------------------------------
  const Name = z.object({ name: z.string().trim().min(1).max(100) });
  const PlId = z.coerce.number().int().positive();
  const exists = (id: number) => !!db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id);

  app.get('/api/playlists', async () => ({
    items: db
      .prepare(
        `SELECT p.id, p.name, p.created_at AS createdAt, COUNT(i.video_id) AS count,
           (SELECT thumbnail FROM playlist_items WHERE playlist_id = p.id ORDER BY position LIMIT 1) AS thumbnail
         FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id GROUP BY p.id ORDER BY p.created_at DESC`,
      )
      .all(),
  }));

  app.post('/api/playlists', async (req, reply) => {
    const b = Name.safeParse(req.body);
    if (!b.success) return bad(reply, 'name is required');
    const r = db.prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)').run(b.data.name, Date.now());
    return reply.code(201).send({ id: Number(r.lastInsertRowid), name: b.data.name });
  });

  app.get<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const id = PlId.safeParse(req.params.id);
    if (!id.success) return bad(reply);
    const pl = db.prepare('SELECT id, name, created_at AS createdAt FROM playlists WHERE id = ?').get(id.data);
    if (!pl) return reply.code(404).send({ error: 'not found' });
    const items = (db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(id.data) as ItemRow[]).map(rowToItem);
    return { ...pl, items };
  });

  app.patch<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const id = PlId.safeParse(req.params.id);
    const b = Name.safeParse(req.body);
    if (!id.success || !b.success) return bad(reply);
    const r = db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(b.data.name, id.data);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const id = PlId.safeParse(req.params.id);
    if (!id.success) return bad(reply);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id.data);
    return { ok: true };
  });

  /** Rewrite positions 0..n-1 in the given order (two passes avoid PK collisions). */
  const rewrite = db.transaction((plId: number, rows: ItemRow[]) => {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(plId);
    const ins = db.prepare(
      'INSERT INTO playlist_items (playlist_id, position, video_id, title, channel_name, duration_sec, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    rows.forEach((r, i) => ins.run(plId, i, r.video_id, r.title, r.channel_name, r.duration_sec, r.thumbnail));
  });
  const itemsOf = (plId: number) => db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(plId) as ItemRow[];

  app.post<{ Params: { id: string } }>('/api/playlists/:id/items', async (req, reply) => {
    const id = PlId.safeParse(req.params.id);
    const t = Track.safeParse(req.body);
    if (!id.success || !t.success) return bad(reply);
    if (!exists(id.data)) return reply.code(404).send({ error: 'not found' });
    const v: Track = t.data;
    const next = (db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM playlist_items WHERE playlist_id = ?').get(id.data) as { p: number }).p;
    db.prepare(
      'INSERT INTO playlist_items (playlist_id, position, video_id, title, channel_name, duration_sec, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id.data, next, v.id, v.title ?? null, v.channelName ?? null, v.durationSec ?? null, v.thumbnail ?? null);
    return reply.code(201).send({ position: next });
  });

  app.delete<{ Params: { id: string; pos: string } }>('/api/playlists/:id/items/:pos', async (req, reply) => {
    const id = PlId.safeParse(req.params.id);
    const pos = z.coerce.number().int().nonnegative().safeParse(req.params.pos);
    if (!id.success || !pos.success) return bad(reply);
    rewrite(id.data, itemsOf(id.data).filter((r) => r.position !== pos.data));
    return { ok: true };
  });

  // Reorder: move the item at `from` to index `to` (the UI's up/down buttons).
  app.patch<{ Params: { id: string } }>('/api/playlists/:id/items', async (req, reply) => {
    const id = PlId.safeParse(req.params.id);
    const b = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).safeParse(req.body);
    if (!id.success || !b.success) return bad(reply);
    const rows = itemsOf(id.data);
    const { from, to } = b.data;
    if (from >= rows.length || to >= rows.length) return bad(reply, 'position out of range');
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved!);
    rewrite(id.data, rows);
    return { ok: true };
  });

  // ---- History -------------------------------------------------------------
  app.get('/api/history', async () => ({
    items: (
      db.prepare('SELECT * FROM history ORDER BY played_at DESC, id DESC LIMIT ?').all(HISTORY_MAX) as Array<{
        id: number; video_id: string; title: string | null; channel_name: string | null; thumbnail: string | null; duration_sec: number | null; played_at: number;
      }>
    ).map((r) => ({
      id: r.video_id, title: r.title ?? '', channelName: r.channel_name ?? undefined, thumbnail: r.thumbnail ?? thumbFor(r.video_id),
      durationSec: r.duration_sec ?? undefined, kind: 'video' as const, playedAt: r.played_at,
    })),
  }));

  app.post('/api/history', async (req, reply) => {
    const t = Track.safeParse(req.body);
    if (!t.success) return bad(reply);
    const v = t.data;
    db.transaction(() => {
      db.prepare('INSERT INTO history (video_id, title, channel_name, thumbnail, duration_sec, played_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        v.id, v.title ?? null, v.channelName ?? null, v.thumbnail ?? null, v.durationSec ?? null, Date.now(),
      );
      db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC, id DESC LIMIT ?)').run(HISTORY_MAX);
    })();
    return reply.code(201).send({ ok: true });
  });
};
