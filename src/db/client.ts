import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'psf_catalog.db';

/**
 * Ordered migrations. Index `i` migrates the database from `user_version = i`
 * to `user_version = i + 1`, so migrations are append-only — never edit one
 * that has shipped.
 */
const MIGRATIONS: readonly string[] = [
  // v1 — companies / formulas / products. The app no longer has free-form
  // photo catalogs; every image belongs to a product. That old database is a
  // separate file, retired by services/legacy-cleanup.
  `
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS formulas (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    formula_id TEXT NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
    image_uri TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_products_formula ON products(formula_id, sort_order);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,

  // v2 — contact details for a company.
  `
  ALTER TABLE companies ADD COLUMN address TEXT;
  ALTER TABLE companies ADD COLUMN phone TEXT;
  `,

  // v3 — non-destructive crops. The framing is stored as 0..1 fractions of the
  // master image instead of being burnt into the file, so the same shot can be
  // re-derived for any grid cell. Existing rows have already been cropped
  // destructively; they get a null crop, which reads as "full frame" — the
  // image they have is the image they keep.
  `
  ALTER TABLE products ADD COLUMN crop_x REAL;
  ALTER TABLE products ADD COLUMN crop_y REAL;
  ALTER TABLE products ADD COLUMN crop_w REAL;
  ALTER TABLE products ADD COLUMN crop_h REAL;
  `,

  // v4 — non-destructive rotation, and soft delete so a removal can be undone.
  // A deleted row keeps its image file until it is purged, which is what makes
  // "Undo" able to give the photo back rather than only the database row.
  `
  ALTER TABLE products ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN deleted_at TEXT;

  CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at);
  `,
];

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  // Foreign keys are per-connection and must be set outside a transaction.
  await database.execAsync('PRAGMA foreign_keys = ON;');

  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    const next = version + 1;
    // Rolls back the whole step if any statement fails, so a half-applied
    // schema can never be recorded as migrated.
    await database.withTransactionAsync(async () => {
      await database.execAsync(sql);
      // `PRAGMA user_version` cannot be bound, but `next` is a number we control.
      await database.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }

  if (__DEV__) {
    console.log(`[db] ${DATABASE_NAME} ready at schema v${version}`);
  }
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  // Concurrent callers during hydrate must share one open+migrate pass.
  if (!opening) {
    opening = (async () => {
      const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
      try {
        await migrate(database);
      } catch (e) {
        opening = null;
        await database.closeAsync().catch(() => undefined);
        throw e;
      }
      db = database;
      return database;
    })();
  }
  return opening;
}

export async function closeDatabase(): Promise<void> {
  const database = db;
  db = null;
  opening = null;
  if (database) {
    await database.closeAsync();
  }
}
