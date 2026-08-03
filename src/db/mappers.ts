import { clampNormalized, type NormalizedRect } from '@/lib/crop-geometry';
import { asRotation } from '@/types/models';
import type {
  Company,
  CompanyListItem,
  Formula,
  FormulaListItem,
  LayoutCrops,
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
  /** 2×2 crop (legacy column names). */
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
  /** 2×3 crop (absent on pre-v5 rows until migration runs). */
  crop_2x3_x?: number | null;
  crop_2x3_y?: number | null;
  crop_2x3_w?: number | null;
  crop_2x3_h?: number | null;
  rotation: number | null;
  deleted_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  company_name?: string;
  formula_name?: string;
};

/** A crop only counts when all four fractions are present and usable. */
function mapRect(
  x: number | null | undefined,
  y: number | null | undefined,
  w: number | null | undefined,
  h: number | null | undefined
): NormalizedRect | null {
  if (x == null || y == null || w == null || h == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }
  if (w <= 0 || h <= 0) return null;
  return clampNormalized({ x, y, w, h });
}

function mapCrops(row: ProductRow): LayoutCrops {
  return {
    '2x2': mapRect(row.crop_x, row.crop_y, row.crop_w, row.crop_h),
    '2x3': mapRect(row.crop_2x3_x, row.crop_2x3_y, row.crop_2x3_w, row.crop_2x3_h),
  };
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
    crops: mapCrops(row),
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
