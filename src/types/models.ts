export type UUID = string;
export type PageSize = 'A4' | 'Letter';

/** How many product images per row in the PDF / preview. */
export type LayoutId = '2x2' | '2-col' | '1-col' | '3-col' | '4-col';

/**
 * A manufacturer / marketing company. Reference list — products point at it.
 */
export interface Company {
  id: UUID;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A generic composition (e.g. "Paracetamol 500mg"). Reference list — products
 * point at it. Formulas are shared across companies, which is what makes a
 * "one formula, every company" catalog possible.
 */
export interface Formula {
  id: UUID;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A product is exactly three things: a company, a formula, and a pack shot.
 */
export interface Product {
  id: UUID;
  companyId: UUID;
  formulaId: UUID;
  imageUri: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Product joined with the names of its company and formula (for lists). */
export interface ProductWithRefs extends Product {
  companyName: string;
  formulaName: string;
}

export interface CompanyListItem extends Company {
  productCount: number;
  /** Distinct formulas this company has products for. */
  formulaCount: number;
  /** First product image, used as the list thumbnail. */
  coverUri: string | null;
}

export interface FormulaListItem extends Formula {
  productCount: number;
  /** Distinct companies that market this formula. */
  companyCount: number;
  coverUri: string | null;
}

export interface CreateCompanyInput {
  name: string;
}

export interface CreateFormulaInput {
  name: string;
}

export interface CreateProductInput {
  companyId: UUID;
  formulaId: UUID;
  imageUri: string;
  width?: number | null;
  height?: number | null;
}

export interface UpdateProductInput {
  companyId?: UUID;
  formulaId?: UUID;
  imageUri?: string;
  width?: number | null;
  height?: number | null;
}

/* -------------------------------------------------------------------------- */
/* PDF scopes                                                                 */
/* -------------------------------------------------------------------------- */

export type ScopeKind = 'company' | 'formula' | 'all-companies' | 'all-formulas';

/**
 * What a generated catalog covers.
 * - `company`       one company's full range
 * - `formula`       one formula across every company that markets it
 * - `all-companies` every company, one labelled section each
 * - `all-formulas`  every formula, one labelled section each
 */
export type CatalogScope =
  | { kind: 'company'; id: UUID }
  | { kind: 'formula'; id: UUID }
  | { kind: 'all-companies' }
  | { kind: 'all-formulas' };

export interface ExportSettings {
  layoutId: LayoutId;
  pageSize: PageSize;
  /** Brand cover page with the document title. */
  includeCover: boolean;
  /** Contents page listing every section (multi-section documents only). */
  includeContents: boolean;
  /** Label page introducing each section before its images. */
  includeSectionLabels: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  layoutId: '2-col',
  pageSize: 'A4',
  includeCover: true,
  includeContents: true,
  includeSectionLabels: true,
};

/** One labelled run of product images inside a generated document. */
export interface CatalogSection {
  id: UUID;
  /** Small caps line above the title, e.g. "COMPANY". */
  kicker: string;
  /** Company or formula name. */
  title: string;
  /** One line describing what this section holds. */
  summary: string;
  /** Heading for the member list, e.g. "Formulas in this section". */
  membersLabel: string;
  /** Formula names (company sections) or company names (formula sections). */
  members: string[];
  products: Product[];
}

/** A fully resolved catalog, ready to render. */
export interface CatalogDocument {
  scope: CatalogScope;
  title: string;
  /** The starting label — what these products are about. */
  subtitle: string;
  sections: CatalogSection[];
  productCount: number;
  generatedAt: string;
  /** Safe filename stem for the exported PDF. */
  fileStem: string;
}

/* -------------------------------------------------------------------------- */
/* Page layouts                                                               */
/* -------------------------------------------------------------------------- */

export type LayoutMeta = {
  id: LayoutId;
  name: string;
  description: string;
  columns: number;
  /** Fixed rows per PDF page (fills page height). */
  rows: number;
  perPage: number;
  /**
   * Optional custom page size in points (72 PPI).
   * Used to keep cells square / compact.
   */
  pageWidth?: number;
  pageHeight?: number;
};

/**
 * PDF page grids.
 * - 2×2 → 4 images on a normal A4 page
 * - 2 per row → 2×3 = 6 on A4
 */
export const LAYOUTS: LayoutMeta[] = [
  {
    id: '2x2',
    name: '2×2 grid',
    description: 'Four pack shots on an A4 page. Crop images to the cell aspect for a clean fit.',
    columns: 2,
    rows: 2,
    perPage: 4,
  },
  {
    id: '2-col',
    name: '2 per row',
    description: 'Two pack shots side by side, three rows — 6 per page on A4, auto-cropped.',
    columns: 2,
    rows: 3,
    perPage: 6,
  },
  {
    id: '1-col',
    name: '1 per row',
    description: 'Full-width pack shots · 2 per page · auto-cropped.',
    columns: 1,
    rows: 2,
    perPage: 2,
  },
  {
    id: '3-col',
    name: '3 per row',
    description: '3×3 grid · 9 per page · auto-cropped.',
    columns: 3,
    rows: 3,
    perPage: 9,
  },
  {
    id: '4-col',
    name: '4 per row',
    description: '4×3 grid · 12 per page · auto-cropped.',
    columns: 4,
    rows: 3,
    perPage: 12,
  },
];

export function layoutMeta(id: LayoutId | string | null | undefined): LayoutMeta {
  const found = LAYOUTS.find((l) => l.id === id);
  // Default: 2 per row (2×3 = 6 on A4)
  return found ?? LAYOUTS.find((l) => l.id === '2-col') ?? LAYOUTS[0];
}

/** Resolve PDF page size in points for the chosen layout + paper. */
export function pageDimensions(settings: {
  pageSize: PageSize;
  layoutId: LayoutId | string;
}): { width: number; height: number } {
  const meta = layoutMeta(settings.layoutId);
  if (meta.pageWidth && meta.pageHeight) {
    return { width: meta.pageWidth, height: meta.pageHeight };
  }
  if (settings.pageSize === 'Letter') return { width: 612, height: 792 };
  return { width: 595, height: 842 }; // A4
}
