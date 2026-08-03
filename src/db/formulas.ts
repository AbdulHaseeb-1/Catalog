import { createId } from '@/lib/id';
import { normalizeKey, tidyName } from '@/lib/text';
import type { CreateFormulaInput, Formula, FormulaListItem } from '@/types/models';

import { getDatabase } from './client';
import { mapFormula, mapFormulaListItem, type FormulaRow } from './mappers';

function nowIso() {
  return new Date().toISOString();
}

const LIST_SQL = `
  SELECT f.*,
    (SELECT COUNT(*) FROM products p
      WHERE p.formula_id = f.id AND p.deleted_at IS NULL) AS product_count,
    (SELECT COUNT(DISTINCT p.company_id) FROM products p
      WHERE p.formula_id = f.id AND p.deleted_at IS NULL) AS company_count,
    (SELECT p.image_uri FROM products p
      WHERE p.formula_id = f.id AND p.deleted_at IS NULL
      ORDER BY p.sort_order ASC, p.created_at ASC LIMIT 1) AS cover_uri
  FROM formulas f
`;

export async function listFormulas(): Promise<FormulaListItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<FormulaRow>(
    `${LIST_SQL} ORDER BY f.name COLLATE NOCASE ASC`
  );
  return rows.map(mapFormulaListItem);
}

export async function getFormula(id: string): Promise<Formula | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<FormulaRow>(`SELECT * FROM formulas WHERE id = ?`, id);
  return row ? mapFormula(row) : null;
}

export async function getFormulaListItem(id: string): Promise<FormulaListItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<FormulaRow>(`${LIST_SQL} WHERE f.id = ?`, id);
  return row ? mapFormulaListItem(row) : null;
}

export async function findFormulaByName(name: string): Promise<Formula | null> {
  const key = normalizeKey(name);
  if (!key) return null;
  const db = await getDatabase();
  const row = await db.getFirstAsync<FormulaRow>(`SELECT * FROM formulas WHERE name_key = ?`, key);
  return row ? mapFormula(row) : null;
}

export async function createFormula(input: CreateFormulaInput): Promise<Formula> {
  const name = tidyName(input.name);
  if (!name) throw new Error('Enter a formula name.');

  const existing = await findFormulaByName(name);
  if (existing) throw new Error(`“${existing.name}” is already in your formulas.`);

  const db = await getDatabase();
  const id = createId();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO formulas (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, name, normalizeKey(name), ts, ts]
  );
  return { id, name, createdAt: ts, updatedAt: ts };
}

export async function renameFormula(id: string, name: string): Promise<Formula> {
  const next = tidyName(name);
  if (!next) throw new Error('Enter a formula name.');

  const existing = await findFormulaByName(next);
  if (existing && existing.id !== id) {
    throw new Error(`“${existing.name}” is already in your formulas.`);
  }

  const current = await getFormula(id);
  if (!current) throw new Error('Formula not found.');

  const db = await getDatabase();
  const ts = nowIso();
  await db.runAsync(`UPDATE formulas SET name = ?, name_key = ?, updated_at = ? WHERE id = ?`, [
    next,
    normalizeKey(next),
    ts,
    id,
  ]);
  return { ...current, name: next, updatedAt: ts };
}

/**
 * Deletes the formula and — via ON DELETE CASCADE — every product using it.
 * Returns the orphaned image paths so the caller can clean up files.
 */
export async function deleteFormula(id: string): Promise<string[]> {
  const db = await getDatabase();
  const images = await db.getAllAsync<{ image_uri: string }>(
    `SELECT image_uri FROM products WHERE formula_id = ?`,
    id
  );
  await db.runAsync(`DELETE FROM formulas WHERE id = ?`, id);
  return images.map((row) => row.image_uri);
}

/**
 * Fold one formula into another, moving its products across. Formulas are the
 * axis a whole catalogue can be grouped by, so a stray near-duplicate splits
 * one composition into two sections.
 */
export async function mergeFormulas(fromId: string, intoId: string): Promise<number> {
  if (fromId === intoId) throw new Error('Pick two different formulas.');

  const [from, into] = await Promise.all([getFormula(fromId), getFormula(intoId)]);
  if (!from || !into) throw new Error('One of those formulas no longer exists.');

  const db = await getDatabase();
  const ts = nowIso();
  let moved = 0;

  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `UPDATE products SET formula_id = ?, updated_at = ? WHERE formula_id = ?`,
      [intoId, ts, fromId]
    );
    moved = result.changes ?? 0;
    await db.runAsync(`DELETE FROM formulas WHERE id = ?`, fromId);
  });

  return moved;
}

export async function countFormulas(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM formulas`);
  return row?.n ?? 0;
}
