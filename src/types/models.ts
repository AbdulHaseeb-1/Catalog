export type UUID = string;
export type PageSize = 'A4' | 'Letter';

/** How many photos per row in the PDF / preview. */
export type LayoutId = '2x2' | '2-col' | '1-col' | '3-col' | '4-col';

export interface Catalog {
  id: UUID;
  title: string;
  layoutId: LayoutId;
  pageSize: PageSize;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: UUID;
  catalogId: UUID;
  uri: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface CatalogWithPhotos extends Catalog {
  photos: Photo[];
}

export interface CatalogListItem extends Catalog {
  photoCount: number;
  /** First photo uri for thumbnail */
  coverUri: string | null;
}

export interface CreateCatalogInput {
  title: string;
  layoutId?: LayoutId;
}

export interface UpdateCatalogInput {
  title?: string;
  layoutId?: LayoutId;
  pageSize?: PageSize;
}

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
   * Used to keep cells square / compact (e.g. 2×2).
   */
  pageWidth?: number;
  pageHeight?: number;
};

/**
 * PDF page grids.
 * - 2×2 → 4 photos on a compact square page
 * - 2 per row → 2×3 = 6 on A4
 */
export const LAYOUTS: LayoutMeta[] = [
  {
    id: '2x2',
    name: '2×2 grid',
    description: 'Four photos on a normal A4 page (2×2). Crop photos to the cell aspect for a clean fit.',
    columns: 2,
    rows: 2,
    perPage: 4,
    // Uses normal A4 / Letter page size from catalog
  },
  {
    id: '2-col',
    name: '2 per row',
    description: 'Two photos side by side, three rows — 6 photos per page on A4, auto-cropped.',
    columns: 2,
    rows: 3,
    perPage: 6,
  },
  {
    id: '1-col',
    name: '1 per row',
    description: 'Full-width photos · 2 per page · auto-cropped.',
    columns: 1,
    rows: 2,
    perPage: 2,
  },
  {
    id: '3-col',
    name: '3 per row',
    description: '3×3 grid · 9 photos per page · auto-cropped.',
    columns: 3,
    rows: 3,
    perPage: 9,
  },
  {
    id: '4-col',
    name: '4 per row',
    description: '4×3 grid · 12 photos per page · auto-cropped.',
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

/** Resolve PDF page size in points for a catalog + layout. */
export function pageDimensionsForCatalog(catalog: {
  pageSize: PageSize;
  layoutId: LayoutId | string;
}): { width: number; height: number } {
  const meta = layoutMeta(catalog.layoutId);
  if (meta.pageWidth && meta.pageHeight) {
    return { width: meta.pageWidth, height: meta.pageHeight };
  }
  if (catalog.pageSize === 'Letter') return { width: 612, height: 792 };
  return { width: 595, height: 842 }; // A4
}
