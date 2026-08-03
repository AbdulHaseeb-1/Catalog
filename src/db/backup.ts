import type { BrandContact, ExportSettings } from '@/types/models';

import { getDatabase } from './client';
import type { CompanyRow, FormulaRow, ProductRow } from './mappers';

/** Everything a restore needs to rebuild the library, minus the image bytes. */
export type BackupTables = {
  companies: CompanyRow[];
  formulas: FormulaRow[];
  products: ProductRow[];
};

export async function readAllRows(): Promise<BackupTables> {
  const db = await getDatabase();
  const [companies, formulas, products] = await Promise.all([
    db.getAllAsync<CompanyRow>(`SELECT * FROM companies ORDER BY created_at ASC`),
    db.getAllAsync<FormulaRow>(`SELECT * FROM formulas ORDER BY created_at ASC`),
    db.getAllAsync<ProductRow>(`SELECT * FROM products ORDER BY created_at ASC`),
  ]);
  return { companies, formulas, products };
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : value == null ? null : String(value);
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Replace the entire library with the contents of a backup.
 *
 * All or nothing: one transaction wipes the tables and re-inserts, so a
 * restore that fails part way leaves the existing catalogue untouched rather
 * than half-overwritten.
 */
export async function replaceAllRows(tables: BackupTables): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    // Products first — the foreign keys point at the other two.
    await db.runAsync(`DELETE FROM products`);
    await db.runAsync(`DELETE FROM companies`);
    await db.runAsync(`DELETE FROM formulas`);

    for (const row of tables.companies) {
      if (!row?.id || !row?.name) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO companies
           (id, name, name_key, address, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.name,
          row.name_key ?? row.name.trim().toLowerCase(),
          text(row.address),
          text(row.phone),
          row.created_at ?? new Date().toISOString(),
          row.updated_at ?? new Date().toISOString(),
        ]
      );
    }

    for (const row of tables.formulas) {
      if (!row?.id || !row?.name) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO formulas (id, name, name_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          row.id,
          row.name,
          row.name_key ?? row.name.trim().toLowerCase(),
          row.created_at ?? new Date().toISOString(),
          row.updated_at ?? new Date().toISOString(),
        ]
      );
    }

    for (const row of tables.products) {
      if (!row?.id || !row?.company_id || !row?.formula_id) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO products
           (id, company_id, formula_id, image_uri, width, height,
            crop_x, crop_y, crop_w, crop_h, rotation, deleted_at,
            sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.company_id,
          row.formula_id,
          row.image_uri ?? '',
          num(row.width),
          num(row.height),
          num(row.crop_x),
          num(row.crop_y),
          num(row.crop_w),
          num(row.crop_h),
          num(row.rotation) ?? 0,
          text(row.deleted_at),
          num(row.sort_order) ?? 0,
          row.created_at ?? new Date().toISOString(),
          row.updated_at ?? new Date().toISOString(),
        ]
      );
    }
  });
}

export type BackupSettings = {
  exportSettings?: ExportSettings;
  brandContact?: BrandContact;
};
