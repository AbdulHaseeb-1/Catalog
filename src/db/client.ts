import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

/** Fresh photo-catalog schema (v2). Drops legacy product tables if present. */
const MIGRATION_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalogs (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  layout_id TEXT NOT NULL DEFAULT '2x2',
  page_size TEXT NOT NULL DEFAULT 'A4',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY NOT NULL,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_catalog ON photos(catalog_id, sort_order);
`;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('photo_catalogs.db');
  await db.execAsync(MIGRATION_SQL);
  // Soft-migrate old catalogs rows that may lack layout_id if reusing name in future
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  } catch {
    // ignore
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
