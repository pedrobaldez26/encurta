import { DatabaseSync } from 'node:sqlite';

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      slug       TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS clicks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT NOT NULL REFERENCES links(slug) ON DELETE CASCADE,
      clicked_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      referrer     TEXT,
      browser      TEXT NOT NULL,
      visitor_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clicks_slug_time ON clicks(slug, clicked_at);
  `);
  return db;
}

export type Db = ReturnType<typeof openDb>;
