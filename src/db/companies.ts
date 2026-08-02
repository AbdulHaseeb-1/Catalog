import { createId } from '@/lib/id';
import { normalizeKey, tidyName } from '@/lib/text';
import type { Company, CompanyListItem, CreateCompanyInput } from '@/types/models';

import { getDatabase } from './client';
import { mapCompany, mapCompanyListItem, type CompanyRow } from './mappers';

function nowIso() {
  return new Date().toISOString();
}

const LIST_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM products p WHERE p.company_id = c.id) AS product_count,
    (SELECT COUNT(DISTINCT p.formula_id) FROM products p WHERE p.company_id = c.id) AS formula_count,
    (SELECT p.image_uri FROM products p WHERE p.company_id = c.id
      ORDER BY p.sort_order ASC, p.created_at ASC LIMIT 1) AS cover_uri
  FROM companies c
`;

export async function listCompanies(): Promise<CompanyListItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CompanyRow>(
    `${LIST_SQL} ORDER BY c.name COLLATE NOCASE ASC`
  );
  return rows.map(mapCompanyListItem);
}

export async function getCompany(id: string): Promise<Company | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CompanyRow>(`SELECT * FROM companies WHERE id = ?`, id);
  return row ? mapCompany(row) : null;
}

export async function getCompanyListItem(id: string): Promise<CompanyListItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CompanyRow>(`${LIST_SQL} WHERE c.id = ?`, id);
  return row ? mapCompanyListItem(row) : null;
}

export async function findCompanyByName(name: string): Promise<Company | null> {
  const key = normalizeKey(name);
  if (!key) return null;
  const db = await getDatabase();
  const row = await db.getFirstAsync<CompanyRow>(
    `SELECT * FROM companies WHERE name_key = ?`,
    key
  );
  return row ? mapCompany(row) : null;
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const name = tidyName(input.name);
  if (!name) throw new Error('Enter a company name.');

  const existing = await findCompanyByName(name);
  if (existing) throw new Error(`“${existing.name}” is already in your companies.`);

  const db = await getDatabase();
  const id = createId();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO companies (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, name, normalizeKey(name), ts, ts]
  );
  return { id, name, createdAt: ts, updatedAt: ts };
}

export async function renameCompany(id: string, name: string): Promise<Company> {
  const next = tidyName(name);
  if (!next) throw new Error('Enter a company name.');

  const existing = await findCompanyByName(next);
  if (existing && existing.id !== id) {
    throw new Error(`“${existing.name}” is already in your companies.`);
  }

  const current = await getCompany(id);
  if (!current) throw new Error('Company not found.');

  const db = await getDatabase();
  const ts = nowIso();
  await db.runAsync(`UPDATE companies SET name = ?, name_key = ?, updated_at = ? WHERE id = ?`, [
    next,
    normalizeKey(next),
    ts,
    id,
  ]);
  return { ...current, name: next, updatedAt: ts };
}

/**
 * Deletes the company and — via ON DELETE CASCADE — all of its products.
 * Returns the image paths that were orphaned so the caller can clean up files.
 */
export async function deleteCompany(id: string): Promise<string[]> {
  const db = await getDatabase();
  const images = await db.getAllAsync<{ image_uri: string }>(
    `SELECT image_uri FROM products WHERE company_id = ?`,
    id
  );
  await db.runAsync(`DELETE FROM companies WHERE id = ?`, id);
  return images.map((row) => row.image_uri);
}

export async function countCompanies(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM companies`);
  return row?.n ?? 0;
}
