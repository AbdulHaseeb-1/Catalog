import { clampNormalized, type NormalizedRect } from '@/lib/crop-geometry';
import { createId } from '@/lib/id';
import { asRotation } from '@/types/models';
import type {
  CreateProductInput,
  LayoutCrops,
  LayoutId,
  Product,
  ProductWithRefs,
  Rotation,
  UpdateProductInput,
} from '@/types/models';

import { getDatabase } from './client';
import { mapProduct, mapProductWithRefs, type ProductRow } from './mappers';

function nowIso() {
  return new Date().toISOString();
}

/** Crop columns in insert/update order — null when there is no crop. */
function cropColumns(crop: NormalizedRect | null | undefined): (number | null)[] {
  if (!crop) return [null, null, null, null];
  const safe = clampNormalized(crop);
  return [safe.x, safe.y, safe.w, safe.h];
}

function normalizeCrops(crops: LayoutCrops | null | undefined): LayoutCrops {
  const out: LayoutCrops = {};
  if (!crops) return out;
  for (const id of ['2x2', '2x3'] as LayoutId[]) {
    if (id in crops) {
      const value = crops[id];
      out[id] = value ? clampNormalized(value) : null;
    }
  }
  return out;
}

/**
 * `recent` powers the products feed, `company` / `formula` power the PDF
 * groupings. Kept as a closed set so the ORDER BY is never built from input.
 */
export type ProductOrder = 'recent' | 'company' | 'formula';

const ORDER_BY: Record<ProductOrder, string> = {
  recent: 'p.created_at DESC, p.sort_order DESC',
  company: 'c.name COLLATE NOCASE ASC, p.sort_order ASC, p.created_at ASC',
  formula: 'f.name COLLATE NOCASE ASC, c.name COLLATE NOCASE ASC, p.sort_order ASC',
};

const SELECT_SQL = `
  SELECT p.*, c.name AS company_name, f.name AS formula_name
  FROM products p
  JOIN companies c ON c.id = p.company_id
  JOIN formulas f ON f.id = p.formula_id
`;

/** Soft-deleted rows are invisible everywhere until they are purged. */
const LIVE = 'p.deleted_at IS NULL';

export async function listProducts(opts?: {
  companyId?: string;
  formulaId?: string;
  order?: ProductOrder;
}): Promise<ProductWithRefs[]> {
  const db = await getDatabase();
  const where: string[] = [LIVE];
  const params: string[] = [];

  if (opts?.companyId) {
    where.push('p.company_id = ?');
    params.push(opts.companyId);
  }
  if (opts?.formulaId) {
    where.push('p.formula_id = ?');
    params.push(opts.formulaId);
  }

  const sql = [
    SELECT_SQL,
    `WHERE ${where.join(' AND ')}`,
    `ORDER BY ${ORDER_BY[opts?.order ?? 'recent']}`,
  ].join('\n');

  const rows = await db.getAllAsync<ProductRow>(sql, params);
  return rows.map(mapProductWithRefs);
}

export async function getProduct(id: string): Promise<ProductWithRefs | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ProductRow>(
    `${SELECT_SQL} WHERE p.id = ? AND ${LIVE}`,
    id
  );
  return row ? mapProductWithRefs(row) : null;
}

/** How many products already pair this company with this formula. */
export async function countProductsForPair(
  companyId: string,
  formulaId: string
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM products
     WHERE company_id = ? AND formula_id = ? AND deleted_at IS NULL`,
    [companyId, formulaId]
  );
  return row?.n ?? 0;
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const db = await getDatabase();
  const id = createId();
  const ts = nowIso();

  // Order is kept per company so a company's catalog follows the order it was
  // built in, regardless of what other companies were added in between.
  const maxOrder = await db.getFirstAsync<{ m: number | null }>(
    `SELECT MAX(sort_order) AS m FROM products WHERE company_id = ?`,
    input.companyId
  );
  const sortOrder = (maxOrder?.m ?? -1) + 1;

  const crops = normalizeCrops(input.crops);
  const rotation = asRotation(input.rotation);

  await db.runAsync(
    `INSERT INTO products
       (id, company_id, formula_id, image_uri, width, height,
        crop_x, crop_y, crop_w, crop_h,
        crop_2x3_x, crop_2x3_y, crop_2x3_w, crop_2x3_h,
        rotation, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.companyId,
      input.formulaId,
      input.imageUri,
      input.width ?? null,
      input.height ?? null,
      ...cropColumns(crops['2x2'] ?? null),
      ...cropColumns(crops['2x3'] ?? null),
      rotation,
      sortOrder,
      ts,
      ts,
    ]
  );

  return {
    id,
    companyId: input.companyId,
    formulaId: input.formulaId,
    imageUri: input.imageUri,
    width: input.width ?? null,
    height: input.height ?? null,
    crops,
    rotation,
    sortOrder,
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function updateProduct(id: string, patch: UpdateProductInput): Promise<Product> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ProductRow>(`SELECT * FROM products WHERE id = ?`, id);
  if (!row) throw new Error('Product not found.');
  const current = mapProduct(row);

  const nextCrops: LayoutCrops =
    patch.crops !== undefined
      ? {
          ...current.crops,
          ...normalizeCrops(patch.crops),
        }
      : current.crops;

  const next: Product = {
    ...current,
    companyId: patch.companyId ?? current.companyId,
    formulaId: patch.formulaId ?? current.formulaId,
    imageUri: patch.imageUri ?? current.imageUri,
    width: patch.width !== undefined ? patch.width : current.width,
    height: patch.height !== undefined ? patch.height : current.height,
    crops: nextCrops,
    rotation: patch.rotation !== undefined ? asRotation(patch.rotation) : current.rotation,
    updatedAt: nowIso(),
  };

  await db.runAsync(
    `UPDATE products
       SET company_id = ?, formula_id = ?, image_uri = ?, width = ?, height = ?,
           crop_x = ?, crop_y = ?, crop_w = ?, crop_h = ?,
           crop_2x3_x = ?, crop_2x3_y = ?, crop_2x3_w = ?, crop_2x3_h = ?,
           rotation = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.companyId,
      next.formulaId,
      next.imageUri,
      next.width,
      next.height,
      ...cropColumns(next.crops['2x2'] ?? null),
      ...cropColumns(next.crops['2x3'] ?? null),
      next.rotation,
      next.updatedAt,
      id,
    ]
  );

  return next;
}

/**
 * Stamp framing onto many products at once. Pack shots for a company are
 * taken on the same rig, so the rects that suit one usually suit the rest.
 * Only layouts present on `framing.crops` are overwritten; others stay put.
 */
export async function applyFraming(
  ids: string[],
  framing: { crops: LayoutCrops; rotation?: Rotation }
): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;

  const db = await getDatabase();
  const ts = nowIso();
  const patch = normalizeCrops(framing.crops);
  const rotation = asRotation(framing.rotation);

  await db.withTransactionAsync(async () => {
    for (const id of unique) {
      const row = await db.getFirstAsync<ProductRow>(
        `SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`,
        id
      );
      if (!row) continue;
      const current = mapProduct(row);
      const next: LayoutCrops = { ...current.crops, ...patch };
      await db.runAsync(
        `UPDATE products
           SET crop_x = ?, crop_y = ?, crop_w = ?, crop_h = ?,
               crop_2x3_x = ?, crop_2x3_y = ?, crop_2x3_w = ?, crop_2x3_h = ?,
               rotation = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          ...cropColumns(next['2x2'] ?? null),
          ...cropColumns(next['2x3'] ?? null),
          rotation,
          ts,
          id,
        ]
      );
    }
  });

  return unique.length;
}

/**
 * Soft delete. The row and its image file both survive so the action can be
 * undone; `purgeDeletedProducts` is what actually frees the bytes.
 */
export async function deleteProduct(id: string): Promise<boolean> {
  return (await deleteProducts([id])) > 0;
}

export async function deleteProducts(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;

  const db = await getDatabase();
  const ts = nowIso();
  let removed = 0;

  await db.withTransactionAsync(async () => {
    for (const id of unique) {
      const result = await db.runAsync(
        `UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        [ts, ts, id]
      );
      removed += result.changes ?? 0;
    }
  });

  return removed;
}

/** Put soft-deleted products back. Powers the "Undo" on the delete toast. */
export async function restoreProducts(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;

  const db = await getDatabase();
  const ts = nowIso();
  let restored = 0;

  await db.withTransactionAsync(async () => {
    for (const id of unique) {
      const result = await db.runAsync(
        `UPDATE products SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
        [ts, id]
      );
      restored += result.changes ?? 0;
    }
  });

  return restored;
}

/**
 * Drop soft-deleted rows for good, returning the image paths that are now
 * unreferenced. Anything deleted longer ago than `olderThanMs` goes; pass 0 to
 * empty the bin outright.
 */
export async function purgeDeletedProducts(olderThanMs: number): Promise<string[]> {
  const db = await getDatabase();
  const cutoff = new Date(Date.now() - Math.max(0, olderThanMs)).toISOString();

  const rows = await db.getAllAsync<{ id: string; image_uri: string }>(
    `SELECT id, image_uri FROM products WHERE deleted_at IS NOT NULL AND deleted_at <= ?`,
    cutoff
  );
  if (!rows.length) return [];

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await db.runAsync(`DELETE FROM products WHERE id = ?`, row.id);
    }
  });

  // A path still used by a live row must never be deleted from disk.
  return unreferencedPaths(rows.map((r) => r.image_uri));
}

/** Filter a set of paths down to those no surviving row points at. */
async function unreferencedPaths(paths: string[]): Promise<string[]> {
  const db = await getDatabase();
  const orphans: string[] = [];
  for (const path of [...new Set(paths.filter(Boolean))]) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM products WHERE image_uri = ?`,
      path
    );
    if (!row?.n) orphans.push(path);
  }
  return orphans;
}

export async function countDeletedProducts(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NOT NULL`
  );
  return row?.n ?? 0;
}

/** Every image path the database still refers to, live or in the bin. */
export async function listReferencedImagePaths(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ image_uri: string }>(
    `SELECT DISTINCT image_uri FROM products WHERE image_uri IS NOT NULL`
  );
  return rows.map((row) => row.image_uri).filter(Boolean);
}

/** Every product row, deleted ones included. */
export async function listAllProductRows(): Promise<ProductRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<ProductRow>(`SELECT * FROM products ORDER BY created_at ASC`);
}

/**
 * Persist a hand-picked order for one company's products. `orderedIds` is the
 * full list for that company, first to last; anything missing from it keeps a
 * position after the ones supplied.
 */
export async function reorderProducts(companyId: string, orderedIds: string[]): Promise<void> {
  if (!orderedIds.length) return;
  const db = await getDatabase();
  const ts = nowIso();

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync(
        `UPDATE products SET sort_order = ?, updated_at = ?
         WHERE id = ? AND company_id = ? AND deleted_at IS NULL`,
        [i, ts, orderedIds[i], companyId]
      );
    }
  });
}

export async function countProducts(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL`
  );
  return row?.n ?? 0;
}
