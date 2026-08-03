import { clampNormalized, type NormalizedRect } from '@/lib/crop-geometry';
import { asRotation } from '@/types/models';
import type {
  Company,
  CompanyListItem,
  Formula,
  FormulaListItem,
  Product,
  ProductWithRefs,
} from '@/types/models';

export type CompanyRow = {
  id: string;
  name: string;
  name_key: string;
  address: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
  product_count?: number;
  formula_count?: number;
  cover_uri?: string | null;
};

export type FormulaRow = {
  id: string;
  name: string;
  name_key: string;
  created_at: string;
  updated_at: string;
  product_count?: number;
  company_count?: number;
  cover_uri?: string | null;
};

export type ProductRow = {
  id: string;
  company_id: string;
  formula_id: string;
  image_uri: string;
  width: number | null;
  height: number | null;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
  rotation: number | null;
  deleted_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  company_name?: string;
  formula_name?: string;
};

/** A crop only counts when all four fractions are present and usable. */
function mapCrop(row: ProductRow): NormalizedRect | null {
  const { crop_x: x, crop_y: y, crop_w: w, crop_h: h } = row;
  if (x == null || y == null || w == null || h == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }
  if (w <= 0 || h <= 0) return null;
  return clampNormalized({ x, y, w, h });
}

export function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? null,
    phone: row.phone ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCompanyListItem(row: CompanyRow): CompanyListItem {
  return {
    ...mapCompany(row),
    productCount: row.product_count ?? 0,
    formulaCount: row.formula_count ?? 0,
    coverUri: row.cover_uri ?? null,
  };
}

export function mapFormula(row: FormulaRow): Formula {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFormulaListItem(row: FormulaRow): FormulaListItem {
  return {
    ...mapFormula(row),
    productCount: row.product_count ?? 0,
    companyCount: row.company_count ?? 0,
    coverUri: row.cover_uri ?? null,
  };
}

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    companyId: row.company_id,
    formulaId: row.formula_id,
    imageUri: row.image_uri,
    width: row.width,
    height: row.height,
    crop: mapCrop(row),
    rotation: asRotation(row.rotation),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProductWithRefs(row: ProductRow): ProductWithRefs {
  return {
    ...mapProduct(row),
    companyName: row.company_name ?? '',
    formulaName: row.formula_name ?? '',
  };
}
