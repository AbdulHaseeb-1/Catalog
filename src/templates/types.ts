import type { BrandContact, CatalogDocument, ExportSettings } from '@/types/models';

export interface PdfRenderContext {
  document: CatalogDocument;
  settings: ExportSettings;
  /** Printed in a box at the foot of every image page. */
  contact: BrandContact;
  /** Must return a data: URI (or absolute http) safe for WebView print. */
  resolveImage: (uri: string | null) => string | null;
  /** Page size in points (72 PPI) for layout math. */
  pageWidth: number;
  pageHeight: number;
}
