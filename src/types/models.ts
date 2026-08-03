import type { NormalizedRect } from '@/lib/crop-geometry';

export type UUID = string;
export type PageSize = 'A4' | 'Letter';

/** How many product images per row in the PDF / preview. */
export type LayoutId = '2x2' | '2-col' | '1-col' | '3-col' | '4-col';

/**
 * A manufacturer / marketing company. Reference list — products point at it.
 * Address and phone are optional and shown on the company's label page.
 */
export interface Company {
  id: UUID;
  name: string;
  address: string | null;
  /** Free text — several numbers can be separated by commas. */
  phone: string | null;
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
 *
 * `imageUri` is the master image and is never overwritten by cropping. What
 * the user framed lives in `crop` as fractions of that master, and the rect
 * that actually gets rendered is derived per export layout — see
 * `lib/crop-geometry`. Baking the crop into the pixels would mean a shot
 * framed for a 2-per-row grid gets centre-chopped by a 4-per-row grid with no
 * way back.
 */
export interface Product {
  id: UUID;
  companyId: UUID;
  formulaId: UUID;
  /** Master image — full frame, as imported. */
  imageUri: string;
  /** Pixel size of the master, needed to turn `crop` back into pixels. */
  width: number | null;
  height: number | null;
  /** User's framing, in 0..1 fractions of the master. Null means full frame. */
  crop: NormalizedRect | null;
  /** Clockwise quarter turns applied before the crop: 0, 90, 180 or 270. */
  rotation: Rotation;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type Rotation = 0 | 90 | 180 | 270;

export function asRotation(value: number | null | undefined): Rotation {
  const turns = ((Math.round((value ?? 0) / 90) % 4) + 4) % 4;
  return (turns * 90) as Rotation;
}

/** Rotating by a quarter turn swaps the frame's width and height. */
export function rotatedSize(
  size: { width: number; height: number },
  rotation: Rotation
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size;
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
  address?: string;
  phone?: string;
}

export interface UpdateCompanyInput {
  name?: string;
  address?: string;
  phone?: string;
}

/**
 * Your own details, printed at the foot of every catalog page so whoever
 * receives the PDF knows who to call. Set once, used by every export.
 */
export interface BrandContact {
  name: string;
  address: string;
  phone: string;
}

export const EMPTY_BRAND_CONTACT: BrandContact = {
  name: '',
  address: '',
  phone: '',
};

/** True when there is anything worth printing in the footer box. */
export function hasContactDetails(contact: BrandContact): boolean {
  return !!(contact.name.trim() || contact.address.trim() || contact.phone.trim());
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
  crop?: NormalizedRect | null;
  rotation?: Rotation;
}

export interface UpdateProductInput {
  companyId?: UUID;
  formulaId?: UUID;
  imageUri?: string;
  width?: number | null;
  height?: number | null;
  /** Pass `null` to clear the crop back to the full frame. */
  crop?: NormalizedRect | null;
  rotation?: Rotation;
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
  /** Your contact details in a box at the foot of every image page. */
  includeContactBox: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  layoutId: '2-col',
  pageSize: 'A4',
  includeCover: true,
  includeContents: true,
  includeSectionLabels: true,
  includeContactBox: true,
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
  /** The company's own address / phone, when this section is a company. */
  contactLines: string[];
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

/** Height of the contact strip at the foot of an image page, in points. */
export const PDF_CONTACT_BOX_HEIGHT = 54;

/**
 * Size of one grid cell in points — the shape every pack shot is rendered
 * into. The contact strip eats into the grid rather than overlapping it, so a
 * page that carries one has slightly shorter cells; ignoring that would make
 * the crop editor's "exact fit" preset quietly inexact.
 */
export function gridCellSize(opts: {
  layoutId: LayoutId | string;
  pageSize: PageSize;
  contactBox?: boolean;
}): { width: number; height: number } {
  const meta = layoutMeta(opts.layoutId);
  const page = pageDimensions(opts);
  const gridHeight = opts.contactBox ? page.height - PDF_CONTACT_BOX_HEIGHT : page.height;
  return {
    width: page.width / Math.max(1, meta.columns),
    height: gridHeight / Math.max(1, meta.rows),
  };
}

/** Aspect (W/H) of one grid cell. */
export function cellAspectRatio(opts: {
  layoutId: LayoutId | string;
  pageSize: PageSize;
  contactBox?: boolean;
}): number {
  const cell = gridCellSize(opts);
  return cell.width / cell.height;
}
