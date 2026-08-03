import type { BrandContact, CatalogDocument, ExportSettings, Product } from '@/types/models';

export interface PdfRenderContext {
  document: CatalogDocument;
  settings: ExportSettings;
  /** Printed in a box at the foot of every image page. */
  contact: BrandContact;
  /**
   * Must return a data: URI (or absolute http) safe for WebView print. Takes
   * the whole product because the bytes depend on its crop, not just its path.
   */
  resolveImage: (product: Product) => string | null;
  /** Page size in points (72 PPI) for layout math. */
  pageWidth: number;
  pageHeight: number;
}
