import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDb(dataDir: string, file = 'encore.db'): DB {
  let db: DB;
  if (file === ':memory:') {
    db = new Database(':memory:');
  } else {
    mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, file));
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Tiny migration runner: numbered .sql files, applied in order, tracked in schema_version. */
export function migrate(db: DB, dir = MIGRATIONS_DIR): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const current = (db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }).v ?? 0;
  const files = readdirSync(dir)
    .map((f) => ({ f, m: /^(\d+)_.+\.sql$/.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .map(({ f, m }) => ({ f, v: Number(m[1]) }))
    .sort((a, b) => a.v - b.v);
  let applied = current;
  for (const { f, v } of files) {
    if (v <= current) continue;
    const sql = readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(v, Date.now());
    })();
    applied = v;
  }
  return applied;
}
