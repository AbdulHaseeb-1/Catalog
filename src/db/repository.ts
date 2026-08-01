import { createId } from '@/lib/id';
import type {
  Catalog,
  CatalogListItem,
  CatalogWithPhotos,
  CreateCatalogInput,
  Photo,
  UpdateCatalogInput,
} from '@/types/models';

import { getDatabase } from './client';
import { mapCatalog, mapCatalogListItem, mapPhoto } from './mappers';

function nowIso() {
  return new Date().toISOString();
}

export async function listCatalogs(): Promise<CatalogListItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Parameters<typeof mapCatalogListItem>[0]>(
    `SELECT c.*,
      (SELECT COUNT(*) FROM photos p WHERE p.catalog_id = c.id) AS photo_count,
      (SELECT p.uri FROM photos p WHERE p.catalog_id = c.id ORDER BY p.sort_order ASC LIMIT 1) AS cover_uri
     FROM catalogs c
     ORDER BY c.updated_at DESC`
  );
  return rows.map(mapCatalogListItem);
}

export async function getCatalog(id: string): Promise<Catalog | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Parameters<typeof mapCatalog>[0]>(
    `SELECT * FROM catalogs WHERE id = ?`,
    [id]
  );
  return row ? mapCatalog(row) : null;
}

export async function getCatalogWithPhotos(id: string): Promise<CatalogWithPhotos | null> {
  const catalog = await getCatalog(id);
  if (!catalog) return null;
  const photos = await listPhotos(id);
  return { ...catalog, photos };
}

export async function createCatalog(input: CreateCatalogInput): Promise<Catalog> {
  const db = await getDatabase();
  const id = createId();
  const ts = nowIso();
  const title = input.title.trim() || 'Untitled Catalog';
  const layoutId = input.layoutId ?? '2x2';
  await db.runAsync(
    `INSERT INTO catalogs (id, title, layout_id, page_size, created_at, updated_at)
     VALUES (?, ?, ?, 'A4', ?, ?)`,
    [id, title, layoutId, ts, ts]
  );
  const created = await getCatalog(id);
  if (!created) throw new Error('Failed to create catalog');
  return created;
}

export async function updateCatalog(id: string, patch: UpdateCatalogInput): Promise<Catalog> {
  const existing = await getCatalog(id);
  if (!existing) throw new Error('Catalog not found');

  const next: Catalog = {
    ...existing,
    title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
    layoutId: patch.layoutId ?? existing.layoutId,
    pageSize: patch.pageSize ?? existing.pageSize,
    updatedAt: nowIso(),
  };

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE catalogs SET title = ?, layout_id = ?, page_size = ?, updated_at = ? WHERE id = ?`,
    [next.title, next.layoutId, next.pageSize, next.updatedAt, id]
  );
  return next;
}

export async function deleteCatalog(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM catalogs WHERE id = ?`, [id]);
}

export async function listPhotos(catalogId: string): Promise<Photo[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Parameters<typeof mapPhoto>[0]>(
    `SELECT * FROM photos WHERE catalog_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [catalogId]
  );
  return rows.map(mapPhoto);
}

export async function addPhoto(input: {
  catalogId: string;
  uri: string;
  width?: number | null;
  height?: number | null;
}): Promise<Photo> {
  const db = await getDatabase();
  const id = createId();
  const ts = nowIso();
  const maxOrder = await db.getFirstAsync<{ m: number | null }>(
    `SELECT MAX(sort_order) as m FROM photos WHERE catalog_id = ?`,
    [input.catalogId]
  );
  const sortOrder = (maxOrder?.m ?? -1) + 1;
  await db.runAsync(
    `INSERT INTO photos (id, catalog_id, uri, sort_order, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.catalogId, input.uri, sortOrder, input.width ?? null, input.height ?? null, ts]
  );
  await touchCatalog(input.catalogId);
  return {
    id,
    catalogId: input.catalogId,
    uri: input.uri,
    sortOrder,
    width: input.width ?? null,
    height: input.height ?? null,
    createdAt: ts,
  };
}

export async function addPhotosBatch(
  catalogId: string,
  items: { uri: string; width?: number | null; height?: number | null }[]
): Promise<Photo[]> {
  if (!items.length) return [];
  const db = await getDatabase();
  const maxOrder = await db.getFirstAsync<{ m: number | null }>(
    `SELECT MAX(sort_order) as m FROM photos WHERE catalog_id = ?`,
    [catalogId]
  );
  let sortOrder = (maxOrder?.m ?? -1) + 1;
  const created: Photo[] = [];
  const ts = nowIso();

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      const id = createId();
      await db.runAsync(
        `INSERT INTO photos (id, catalog_id, uri, sort_order, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, catalogId, item.uri, sortOrder, item.width ?? null, item.height ?? null, ts]
      );
      created.push({
        id,
        catalogId,
        uri: item.uri,
        sortOrder,
        width: item.width ?? null,
        height: item.height ?? null,
        createdAt: ts,
      });
      sortOrder += 1;
    }
  });

  await touchCatalog(catalogId);
  return created;
}

export async function updatePhotoUri(
  id: string,
  uri: string,
  width?: number | null,
  height?: number | null
): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ catalog_id: string }>(
    `SELECT catalog_id FROM photos WHERE id = ?`,
    id
  );
  if (!row) throw new Error('Photo not found');
  await db.runAsync(
    `UPDATE photos SET uri = ?, width = ?, height = ? WHERE id = ?`,
    uri,
    width ?? null,
    height ?? null,
    id
  );
  await touchCatalog(row.catalog_id);
}

export async function getPhoto(id: string): Promise<Photo | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Parameters<typeof mapPhoto>[0]>(
    `SELECT * FROM photos WHERE id = ?`,
    id
  );
  return row ? mapPhoto(row) : null;
}

export async function deletePhoto(id: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ catalog_id: string; uri: string }>(
    `SELECT catalog_id, uri FROM photos WHERE id = ?`,
    id
  );
  if (!row) {
    console.warn('[db] deletePhoto: no row for', id);
    return false;
  }
  const result = await db.runAsync(`DELETE FROM photos WHERE id = ?`, id);
  if (__DEV__) {
    console.log('[db] deletePhoto', id, 'changes=', result.changes);
  }
  await touchCatalog(row.catalog_id);
  return (result.changes ?? 0) > 0;
}

export async function deletePhotos(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;

  const db = await getDatabase();
  const first = await db.getFirstAsync<{ catalog_id: string }>(
    `SELECT catalog_id FROM photos WHERE id = ?`,
    unique[0]
  );

  // Delete one-by-one — more reliable than IN (...) binding quirks across platforms
  let deleted = 0;
  await db.withTransactionAsync(async () => {
    for (const id of unique) {
      const result = await db.runAsync(`DELETE FROM photos WHERE id = ?`, id);
      deleted += result.changes ?? 0;
    }
  });

  if (__DEV__) {
    console.log('[db] deletePhotos', unique.length, 'requested, deleted=', deleted);
  }
  if (first) await touchCatalog(first.catalog_id);
  return deleted;
}

async function touchCatalog(catalogId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE catalogs SET updated_at = ? WHERE id = ?`, [nowIso(), catalogId]);
}
