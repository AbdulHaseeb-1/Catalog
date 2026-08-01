import type { Catalog, Photo } from '@/types/models';

export interface PdfRenderContext {
  catalog: Catalog;
  photos: Photo[];
  /** Must return a data: URI (or absolute http) safe for WebView print. */
  resolveImage: (uri: string | null) => string | null;
  generatedAt: string;
  /** Page size in points (72 PPI) for layout math */
  pageWidth?: number;
  pageHeight?: number;
}
