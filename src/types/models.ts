import type { NormalizedRect } from '@/lib/crop-geometry';

export type UUID = string;
export type PageSize = 'A4' | 'Letter';

/**
 * Page grids available for export. Each product stores a crop per layout so
 * framing for a tall 2×2 cell is not silently reused on a shorter 2×3 cell.
 */
export type LayoutId = '2x2' | '2x3';

/** Framing map: one optional normalized crop per layout. */
export type LayoutCrops = Partial<Record<LayoutId, NormalizedRect | null>>;

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
 * `imageUri` is the master image and is never overwritten by cropping. Framing
 * lives in `crops` as 0..1 fractions of that master, one rect per page layout.
 * Export picks the rect for the active grid — see `cropForLayout`. Baking a
 * crop into pixels would destroy the master and make multi-grid re-framing
 * impossible.
 */
export interface Product {
  id: UUID;
  companyId: UUID;
  formulaId: UUID;
  /** Master image — full frame, as imported. */
  imageUri: string;
  /** Pixel size of the master, needed to turn crops back into pixels. */
  width: number | null;
  height: number | null;
  /**
   * Framing per layout, in 0..1 fractions of the rotated master.
   * Missing / null for a layout means full frame until the user crops it.
   */
  crops: LayoutCrops;
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
 *
 * Phones open WhatsApp; address text links to `mapsUrl` (Google Maps) when set.
 */
export interface BrandContact {
  name: string;
  /** Shown in the footer. Tappable when `mapsUrl` is set. */
  address: string;
  /**
   * Google Maps (or any https maps) link. The PDF shows `address` as the label
   * and opens this URL on tap — the raw URL is not printed.
   */
  mapsUrl: string;
  /** CEO / principal mobile — WhatsApp link in the footer. */
  ceoPhone: string;
  /** Office / general line — WhatsApp link in the footer. */
  officePhone: string;
}

export const EMPTY_BRAND_CONTACT: BrandContact = {
  name: '',
  address: '',
  mapsUrl: '',
  ceoPhone: '',
  officePhone: '',
};

/** True when there is anything worth printing in the footer box. */
export function hasContactDetails(contact: BrandContact): boolean {
  return !!(
    contact.name.trim() ||
    contact.address.trim() ||
    contact.ceoPhone.trim() ||
    contact.officePhone.trim()
  );
}

/**
 * Build a WhatsApp chat URL from a phone field. Digits only; leading `00`
 * stripped. Include the country code (e.g. 92300…) so the link opens chat
 * correctly on any device.
 */
export function whatsAppHref(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

/**
 * Safe http(s) URL for the address link. Rejects empty or non-http schemes so
 * a bad settings value cannot inject javascript: into the PDF.
 */
export function mapsHref(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** tel: link for phone apps (digits only, keeps leading + via country digits). */
export function telHref(phone: string): string | null {
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  const bare = digits.replace(/\D/g, '');
  if (bare.length < 8) return null;
  return `tel:${digits.startsWith('+') ? digits : bare}`;
}

/** Cell size in millimetres (points × 25.4 / 72). */
export function gridCellSizeMm(opts: {
  layoutId: LayoutId | string;
  pageSize: PageSize;
  contactBox?: boolean;
}): { widthMm: number; heightMm: number } {
  const cell = gridCellSize(opts);
  const toMm = (pt: number) => Math.round((pt * 25.4) / 72);
  return { widthMm: toMm(cell.width), heightMm: toMm(cell.height) };
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
  crops?: LayoutCrops;
  rotation?: Rotation;
}

export interface UpdateProductInput {
  companyId?: UUID;
  formulaId?: UUID;
  imageUri?: string;
  width?: number | null;
  height?: number | null;
  /**
   * Partial crop map merged into the product. Pass `null` for a layout key to
   * clear that layout back to full frame.
   */
  crops?: LayoutCrops;
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
  /**
   * When true, products without a saved crop for the active layout are left
   * out of the PDF (instead of falling back to the full frame).
   */
  framedOnly: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  layoutId: '2x2',
  pageSize: 'A4',
  includeCover: true,
  includeContents: true,
  includeSectionLabels: true,
  includeContactBox: true,
  framedOnly: false,
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

/** Four pack shots to a page — two across, two down. */
export const GRID_2X2: LayoutMeta = {
  id: '2x2',
  name: '2 × 2',
  description: 'Four pack shots on a page — two across, two down.',
  columns: 2,
  rows: 2,
  perPage: 4,
};

/** Six pack shots to a page — two across, three down. */
export const GRID_2X3: LayoutMeta = {
  id: '2x3',
  name: '2 × 3',
  description: 'Six pack shots on a page — two across, three down.',
  columns: 2,
  rows: 3,
  perPage: 6,
};

export const LAYOUTS: LayoutMeta[] = [GRID_2X2, GRID_2X3];

const LAYOUT_BY_ID: Record<LayoutId, LayoutMeta> = {
  '2x2': GRID_2X2,
  '2x3': GRID_2X3,
};

/** Resolve layout metadata; unknown / legacy ids fall back to 2×2. */
export function layoutMeta(id?: LayoutId | string | null): LayoutMeta {
  return LAYOUT_BY_ID[toLayoutId(id)];
}

/** Coerce a stored or user-supplied id to a supported layout. */
export function toLayoutId(id?: LayoutId | string | null): LayoutId {
  if (id === '2x2' || id === '2x3') return id;
  return '2x2';
}

/** Crop saved for a layout, or null when that layout was never framed. */
export function cropForLayout(
  product: { crops?: LayoutCrops | null },
  layoutId: LayoutId | string
): NormalizedRect | null {
  const id = toLayoutId(layoutId);
  const rect = product.crops?.[id];
  return rect ?? null;
}

/** True when the user has saved a framing for this layout (not full-frame default). */
export function hasCropForLayout(
  product: { crops?: LayoutCrops | null },
  layoutId: LayoutId | string
): boolean {
  return cropForLayout(product, layoutId) != null;
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

/**
 * Height of the contact strip at the foot of an image page, in points.
 * Tall enough for name + address + two labelled phone links.
 */
export const PDF_CONTACT_BOX_HEIGHT = 68;

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

/** The export shape previews and the crop editor measure themselves against. */
export type PageContext = {
  layoutId: LayoutId;
  pageSize: PageSize;
  /** Whether the export prints the contact strip — it shortens every cell. */
  contactBox?: boolean;
};

/** Print resolution a pack shot should hit to look sharp on paper. */
export const PRINT_DPI = 300;
/** Below this the picture starts to look soft in print. */
const ACCEPTABLE_DPI = 180;

/**
 * Pixel size a cropped pack shot should be to print sharply in this grid.
 *
 * Cells are measured in points (72 per inch), so a 2×2 cell about 4 inches
 * tall wants roughly 1200px of image to hold up at 300 DPI. Denser grids need
 * less, which is worth telling the user before they shoot a whole range.
 */
export function recommendedSourcePixels(opts: {
  layoutId: LayoutId | string;
  pageSize: PageSize;
  contactBox?: boolean;
}): { width: number; height: number; minWidth: number; minHeight: number } {
  // The cell is filled edge to edge, so these are the cell's own dimensions —
  // a crop at exactly this size is the cell's shape and needs no scaling.
  const cell = gridCellSize(opts);
  const px = (points: number, dpi: number) => Math.round((points / 72) * dpi);
  return {
    width: px(cell.width, PRINT_DPI),
    height: px(cell.height, PRINT_DPI),
    minWidth: px(cell.width, ACCEPTABLE_DPI),
    minHeight: px(cell.height, ACCEPTABLE_DPI),
  };
}

/**
 * How a cropped pack shot measures up in a given grid. `ratio` is 1 when the
 * crop has every pixel the grid wants; below 1 it will be upscaled to fill the
 * cell and start to soften.
 */
export function assessResolution(
  crop: { width: number; height: number },
  opts: { layoutId: LayoutId | string; pageSize: PageSize; contactBox?: boolean }
): { ratio: number; ok: boolean; ideal: { width: number; height: number } } {
  const want = recommendedSourcePixels(opts);
  // Fitted whole, so the binding side is whichever runs out first.
  const ratio = Math.min(crop.width / want.width, crop.height / want.height);
  return {
    ratio,
    ok: crop.width >= want.minWidth && crop.height >= want.minHeight,
    ideal: { width: want.width, height: want.height },
  };
}
