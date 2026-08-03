import { createId } from '@/lib/id';
import { normalizeKey, tidyName } from '@/lib/text';
import type {
  Company,
  CompanyListItem,
  CreateCompanyInput,
  UpdateCompanyInput,
} from '@/types/models';

import { getDatabase } from './client';
import { mapCompany, mapCompanyListItem, type CompanyRow } from './mappers';

function nowIso() {
  return new Date().toISOString();
}

const LIST_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM products p
      WHERE p.company_id = c.id AND p.deleted_at IS NULL) AS product_count,
    (SELECT COUNT(DISTINCT p.formula_id) FROM products p
      WHERE p.company_id = c.id AND p.deleted_at IS NULL) AS formula_count,
    (SELECT p.image_uri FROM products p
      WHERE p.company_id = c.id AND p.deleted_at IS NULL
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

/** Optional free-text field: blank becomes NULL rather than an empty string. */
function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const name = tidyName(input.name);
  if (!name) throw new Error('Enter a company name.');

  const existing = await findCompanyByName(name);
  if (existing) throw new Error(`“${existing.name}” is already in your companies.`);

  const db = await getDatabase();
  const id = createId();
  const ts = nowIso();
  const address = optionalText(input.address);
  const phone = optionalText(input.phone);

  await db.runAsync(
    `INSERT INTO companies (id, name, name_key, address, phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, normalizeKey(name), address, phone, ts, ts]
  );
  return { id, name, address, phone, createdAt: ts, updatedAt: ts };
}

/** Update any of name / address / phone. Omitted fields are left alone. */
export async function updateCompany(id: string, patch: UpdateCompanyInput): Promise<Company> {
  const current = await getCompany(id);
  if (!current) throw new Error('Company not found.');

  const name = patch.name !== undefined ? tidyName(patch.name) : current.name;
  if (!name) throw new Error('Enter a company name.');

  if (name !== current.name) {
    const clash = await findCompanyByName(name);
    if (clash && clash.id !== id) {
      throw new Error(`“${clash.name}” is already in your companies.`);
    }
  }

  const next: Company = {
    ...current,
    name,
    address: patch.address !== undefined ? optionalText(patch.address) : current.address,
    phone: patch.phone !== undefined ? optionalText(patch.phone) : current.phone,
    updatedAt: nowIso(),
  };

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE companies SET name = ?, name_key = ?, address = ?, phone = ?, updated_at = ?
     WHERE id = ?`,
    [next.name, normalizeKey(next.name), next.address, next.phone, next.updatedAt, id]
  );
  return next;
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

/**
 * Fold one company into another: its products move across, then the empty
 * shell is dropped. `name_key` only blocks exact repeats, so near-duplicates
 * like "Acme Pharma" and "Acme Pharma Ltd" otherwise split a range across two
 * sections of the catalogue.
 */
export async function mergeCompanies(fromId: string, intoId: string): Promise<number> {
  if (fromId === intoId) throw new Error('Pick two different companies.');

  const [from, into] = await Promise.all([getCompany(fromId), getCompany(intoId)]);
  if (!from || !into) throw new Error('One of those companies no longer exists.');

  const db = await getDatabase();
  const ts = nowIso();
  let moved = 0;

  await db.withTransactionAsync(async () => {
    // Continue the target's numbering so the merged range keeps a stable order.
    const max = await db.getFirstAsync<{ m: number | null }>(
      `SELECT MAX(sort_order) AS m FROM products WHERE company_id = ?`,
      intoId
    );
    let next = (max?.m ?? -1) + 1;

    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM products WHERE company_id = ? ORDER BY sort_order ASC, created_at ASC`,
      fromId
    );

    for (const row of rows) {
      await db.runAsync(
        `UPDATE products SET company_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
        [intoId, next, ts, row.id]
      );
      next += 1;
      moved += 1;
    }

    // Keep any detail the surviving record is missing rather than losing it.
    await db.runAsync(
      `UPDATE companies
         SET address = COALESCE(address, ?), phone = COALESCE(phone, ?), updated_at = ?
       WHERE id = ?`,
      [from.address, from.phone, ts, intoId]
    );
    await db.runAsync(`DELETE FROM companies WHERE id = ?`, fromId);
  });

  return moved;
}

export async function countCompanies(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM companies`);
  return row?.n ?? 0;
}
