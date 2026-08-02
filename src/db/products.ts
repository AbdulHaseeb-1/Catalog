import { createId } from '@/lib/id';
import type { CreateProductInput, Product, ProductWithRefs, UpdateProductInput } from '@/types/models';

import { getDatabase } from './client';
import { mapProduct, mapProductWithRefs, type ProductRow } from './mappers';

function nowIso() {
  return new Date().toISOString();
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

export async function listProducts(opts?: {
  companyId?: string;
  formulaId?: string;
  order?: ProductOrder;
}): Promise<ProductWithRefs[]> {
  const db = await getDatabase();
  const where: string[] = [];
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
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    `ORDER BY ${ORDER_BY[opts?.order ?? 'recent']}`,
  ].join('\n');

  const rows = await db.getAllAsync<ProductRow>(sql, params);
  return rows.map(mapProductWithRefs);
}

export async function getProduct(id: string): Promise<ProductWithRefs | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ProductRow>(`${SELECT_SQL} WHERE p.id = ?`, id);
  return row ? mapProductWithRefs(row) : null;
}

/** How many products already pair this company with this formula. */
export async function countProductsForPair(
  companyId: string,
  formulaId: string
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM products WHERE company_id = ? AND formula_id = ?`,
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

  await db.runAsync(
    `INSERT INTO products
       (id, company_id, formula_id, image_uri, width, height, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.companyId,
      input.formulaId,
      input.imageUri,
      input.width ?? null,
      input.height ?? null,
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

  const next: Product = {
    ...current,
    companyId: patch.companyId ?? current.companyId,
    formulaId: patch.formulaId ?? current.formulaId,
    imageUri: patch.imageUri ?? current.imageUri,
    width: patch.width !== undefined ? patch.width : current.width,
    height: patch.height !== undefined ? patch.height : current.height,
    updatedAt: nowIso(),
  };

  await db.runAsync(
    `UPDATE products
       SET company_id = ?, formula_id = ?, image_uri = ?, width = ?, height = ?, updated_at = ?
     WHERE id = ?`,
    [next.companyId, next.formulaId, next.imageUri, next.width, next.height, next.updatedAt, id]
  );

  return next;
}

/** Returns the removed image path, or null when the product was already gone. */
export async function deleteProduct(id: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ image_uri: string }>(
    `SELECT image_uri FROM products WHERE id = ?`,
    id
  );
  if (!row) return null;
  await db.runAsync(`DELETE FROM products WHERE id = ?`, id);
  return row.image_uri;
}

export async function deleteProducts(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];

  const db = await getDatabase();
  const removed: string[] = [];

  await db.withTransactionAsync(async () => {
    for (const id of unique) {
      const row = await db.getFirstAsync<{ image_uri: string }>(
        `SELECT image_uri FROM products WHERE id = ?`,
        id
      );
      if (!row) continue;
      await db.runAsync(`DELETE FROM products WHERE id = ?`, id);
      removed.push(row.image_uri);
    }
  });

  return removed;
}

export async function countProducts(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM products`);
  return row?.n ?? 0;
}
