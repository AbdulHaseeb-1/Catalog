import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { effectiveCrop } from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { slugify } from '@/lib/text';
import { renderCatalogHtml } from '@/templates';
import {
  cropForLayout,
  gridCellSize,
  hasContactDetails,
  pageDimensions,
  rotatedSize,
  type BrandContact,
  type CatalogDocument,
  type CatalogScope,
  type ExportSettings,
  type LayoutId,
  type Product,
} from '@/types/models';

import { buildCatalogDocument } from './catalog-document';
import { toPdfDataUri } from './image-service';

/**
 * Every product image is inlined as base64, so a big catalogue becomes one
 * enormous HTML string. Handing 40 MB+ of markup to the print engine or the
 * preview WebView reliably kills the native process — an app that vanishes
 * with nothing in the JS logs. These caps turn that into a readable error.
 */
const MAX_PREVIEW_BYTES = 24 * 1024 * 1024;
const MAX_EXPORT_BYTES = 48 * 1024 * 1024;

/** Permanent on-device folder under the app documents directory. */
export const CATALOGS_FOLDER = 'Catalogs';
/** Legacy temp folder — still cleaned by “Free up space”, not used for new PDFs. */
export const LEGACY_EXPORTS_FOLDER = 'exports';

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function withSlash(root: string): string {
  return root.endsWith('/') ? root : `${root}/`;
}

/** Absolute path to Documents/Catalogs (or null on web). */
export function catalogsDirectory(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${withSlash(root)}${CATALOGS_FOLDER}`;
}

function assertWithinBudget(html: string, limit: number, what: 'preview' | 'export'): void {
  const size = html.length;
  if (size <= limit) return;

  const advice =
    'Switch to 2 × 3 for denser pages, export a single company or formula, or turn off the cover and label pages.';
  throw new Error(
    what === 'preview'
      ? `This catalogue is too large to preview (${megabytes(size)}). ${advice}`
      : `This catalogue is too large to export in one file (${megabytes(size)}). ${advice}`
  );
}

export type GenerateResult = {
  /** Absolute file URI of the PDF under the app Documents/Catalogs folder. */
  uri: string;
  /** Display path (folder + filename) for the success message. */
  savedAs?: string;
  /** Size on disk, when known. */
  bytes?: number;
  /** Web has no file to share — the browser print dialog was opened instead. */
  webPrint?: boolean;
  numberOfPages?: number;
  document: CatalogDocument;
  /** Images that could not be embedded (page still prints empty cells). */
  failedImages?: number;
};

/**
 * Print resolution multiplier over the cell's point size. Anything beyond this
 * is detail the page cannot show, paid for in megabytes.
 */
const CELL_PIXEL_DENSITY = 2.5;

function targetCell(settings: ExportSettings, contact: BrandContact) {
  const cell = gridCellSize({
    layoutId: settings.layoutId,
    pageSize: settings.pageSize,
    contactBox: settings.includeContactBox && hasContactDetails(contact),
  });
  return {
    aspect: cell.width / cell.height,
    // Integer pixel budget — the manipulator and print engine both prefer ints.
    maxWidth: Math.max(
      1,
      Math.ceil(Math.max(cell.width, cell.height) * CELL_PIXEL_DENSITY)
    ),
  };
}

const ENCODE_CONCURRENCY = 4;

const encodeCache = new Map<string, string>();
const ENCODE_CACHE_LIMIT = 400;

function cacheGet(key: string): string | undefined {
  const hit = encodeCache.get(key);
  if (hit === undefined) return undefined;
  encodeCache.delete(key);
  encodeCache.set(key, hit);
  return hit;
}

function cachePut(key: string, value: string): void {
  encodeCache.set(key, value);
  while (encodeCache.size > ENCODE_CACHE_LIMIT) {
    const oldest = encodeCache.keys().next().value;
    if (oldest === undefined) break;
    encodeCache.delete(oldest);
  }
}

/** Drop cached bytes for images whose pixels may have changed on disk. */
export function invalidateEncodedImages(): void {
  encodeCache.clear();
}

async function embedImages(
  doc: CatalogDocument,
  cell: { aspect: number; maxWidth: number },
  layoutId: LayoutId | string
): Promise<{ map: Map<string, string>; failed: number }> {
  const resolved = new Map<string, string>();
  let failed = 0;

  const pending = new Map<string, Product>();
  let fromCache = 0;
  for (const section of doc.sections) {
    for (const product of section.products) {
      const key = imageKey(product, cell, layoutId);
      if (!key || resolved.has(key) || pending.has(key)) continue;
      const cached = cacheGet(key);
      if (cached) {
        resolved.set(key, cached);
        fromCache += 1;
      } else {
        pending.set(key, product);
      }
    }
  }

  const jobs = [...pending.entries()];
  let cursor = 0;

  const worker = async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      const [key, product] = jobs[index];

      const crop = effectiveCrop(
        cropForLayout(product, layoutId),
        product.width && product.height
          ? rotatedSize({ width: product.width, height: product.height }, product.rotation)
          : null
      );

      const encodeOnce = () =>
        toPdfDataUri(product.imageUri, {
          rotation: product.rotation,
          crop,
          maxWidth: cell.maxWidth,
        });

      try {
        let dataUri = await encodeOnce();
        // One silent retry — manipulators occasionally flake under load.
        if (!dataUri?.startsWith('data:')) {
          await new Promise((r) => setTimeout(r, 80));
          dataUri = await encodeOnce();
        }
        if (dataUri?.startsWith('data:')) {
          resolved.set(key, dataUri);
          cachePut(key, dataUri);
        } else {
          failed += 1;
          console.warn('[pdf] Could not embed image for product', product.id);
        }
      } catch (e) {
        try {
          await new Promise((r) => setTimeout(r, 80));
          const dataUri = await encodeOnce();
          if (dataUri?.startsWith('data:')) {
            resolved.set(key, dataUri);
            cachePut(key, dataUri);
          } else {
            failed += 1;
            reportError('pdf', e);
          }
        } catch (e2) {
          failed += 1;
          reportError('pdf', e2);
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ENCODE_CONCURRENCY, Math.max(1, jobs.length)) }, worker)
  );

  if (resolved.size === 0 && doc.productCount > 0) {
    throw new Error(
      'None of the product images could be read. Re-add the images, then export again.'
    );
  }

  if (__DEV__) {
    console.log(
      `[pdf] ${resolved.size} image(s) ready — ${jobs.length - failed} encoded, ` +
        `${fromCache} from cache, ${failed} failed`
    );
  }

  return { map: resolved, failed };
}

function imageKey(
  product: Product,
  cell: { aspect: number; maxWidth: number },
  layoutId: LayoutId | string
): string | null {
  if (!product.imageUri) return null;
  const c = cropForLayout(product, layoutId);
  const frame = c
    ? `${c.x.toFixed(4)},${c.y.toFixed(4)},${c.w.toFixed(4)},${c.h.toFixed(4)}`
    : 'full';
  return [
    product.imageUri,
    layoutId,
    frame,
    product.rotation,
    cell.aspect.toFixed(4),
    cell.maxWidth,
    product.updatedAt,
  ].join('#');
}

async function buildHtml(
  doc: CatalogDocument,
  settings: ExportSettings,
  contact: BrandContact
): Promise<{ html: string; failedImages: number }> {
  const dims = pageDimensions(settings);
  // Integer page size — fractional points confuse native print engines.
  const width = Math.round(dims.width);
  const height = Math.round(dims.height);
  const cell = targetCell(settings, contact);
  const { map, failed } = await embedImages(doc, cell, settings.layoutId);

  const html = renderCatalogHtml({
    document: doc,
    settings,
    contact,
    resolveImage: (product) => {
      const key = imageKey(product, cell, settings.layoutId);
      return key ? (map.get(key) ?? null) : null;
    },
    pageWidth: width,
    pageHeight: height,
  });

  if (__DEV__) {
    console.log(
      `[pdf] ${doc.sections.length} section(s), ${doc.productCount} product(s), ` +
        `${map.size} image(s), ${html.length} chars, page ${width}×${height}`
    );
  }

  return { html, failedImages: failed };
}

function assertPrintable(doc: CatalogDocument): void {
  if (!doc.productCount || !doc.sections.length) {
    throw new Error('There are no products in this selection yet. Add one and try again.');
  }
}

function countPages(html: string): number {
  return (html.match(/class="page"/g) ?? []).length;
}

/** HTML for the on-device preview — the same document the export produces. */
export async function buildPreviewHtml(
  scope: CatalogScope,
  settings: ExportSettings,
  contact: BrandContact
): Promise<{ html: string; document: CatalogDocument; pageCount: number }> {
  let doc = await buildCatalogDocument(scope);
  doc = applyFramedOnlyFilter(doc, settings);
  assertPrintable(doc);
  const { html } = await buildHtml(doc, settings, contact);
  assertWithinBudget(html, MAX_PREVIEW_BYTES, 'preview');
  return { html, document: doc, pageCount: countPages(html) };
}

async function printHtmlOnWeb(html: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF export is only available in a browser or the native app.');
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'style',
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
  );
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!frameDoc) {
    document.body.removeChild(iframe);
    throw new Error('Could not open the print frame.');
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } finally {
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // already gone
      }
    }, 1000);
  }
}

async function ensureCatalogsDir(): Promise<string> {
  const dir = catalogsDirectory();
  if (!dir) {
    throw new Error('On-device document storage is not available on this platform.');
  }
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Move (or copy) the print engine’s temp PDF into Documents/Catalogs with a
 * stable name. Files here survive app restarts; cache paths do not.
 */
async function saveToDocumentsFolder(
  sourceUri: string,
  fileStem: string,
  layoutId: string
): Promise<{ uri: string; savedAs: string; bytes: number }> {
  const dir = await ensureCatalogsDir();
  const day = new Date().toISOString().slice(0, 10);
  const base = slugify(`${fileStem}-${layoutId}-${day}`, 'catalogue');
  let filename = `${base}.pdf`;
  let dest = `${dir}/${filename}`;

  // Keep an earlier export of the same day/layout with a time suffix.
  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists) {
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    filename = `${base}-${stamp}.pdf`;
    dest = `${dir}/${filename}`;
  }

  try {
    await FileSystem.moveAsync({ from: sourceUri, to: dest });
  } catch {
    // Some platforms refuse move from the print cache — copy then delete.
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    try {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true });
    } catch {
      // temp cleanup is best-effort
    }
  }

  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists) {
    throw new Error('The PDF could not be saved to the Documents folder.');
  }
  const bytes = typeof info.size === 'number' ? info.size : 0;
  if (bytes > 0 && bytes < 200) {
    throw new Error('The PDF file looks empty. Try exporting again.');
  }

  return {
    uri: dest,
    savedAs: `${CATALOGS_FOLDER}/${filename}`,
    bytes,
  };
}

async function printToTempFile(
  html: string,
  width: number,
  height: number
): Promise<{ uri: string; numberOfPages?: number }> {
  const options: Print.FilePrintOptions = {
    html,
    width,
    height,
    // iOS honours these; Android uses the HTML @page rules + width/height.
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  try {
    return await Print.printToFileAsync(options);
  } catch (first) {
    // One retry after a short pause — native print can flake under memory pressure.
    reportError('pdf', first);
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await Print.printToFileAsync(options);
    } catch (second) {
      reportError('pdf', second);
      throw new Error(
        `PDF engine failed: ${toMessage(second)}. Try 2 × 3 for denser pages, or a narrower selection.`
      );
    }
  }
}

/** Drop products that have no crop for the active layout when framedOnly is on. */
function applyFramedOnlyFilter(
  doc: CatalogDocument,
  settings: ExportSettings
): CatalogDocument {
  if (!settings.framedOnly) return doc;
  const sections = doc.sections
    .map((section) => ({
      ...section,
      products: section.products.filter((p) => cropForLayout(p, settings.layoutId) != null),
    }))
    .filter((section) => section.products.length > 0);
  const productCount = sections.reduce((n, s) => n + s.products.length, 0);
  return { ...doc, sections, productCount };
}

export async function generatePdf(
  scope: CatalogScope,
  settings: ExportSettings,
  contact: BrandContact
): Promise<GenerateResult> {
  let doc = await buildCatalogDocument(scope);
  doc = applyFramedOnlyFilter(doc, settings);
  assertPrintable(doc);

  const { html, failedImages } = await buildHtml(doc, settings, contact);
  assertWithinBudget(html, MAX_EXPORT_BYTES, 'export');
  const expectedPages = countPages(html);

  const dims = pageDimensions(settings);
  const width = Math.round(dims.width);
  const height = Math.round(dims.height);

  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return { uri: '', webPrint: true, document: doc, failedImages, numberOfPages: expectedPages };
  }

  const result = await printToTempFile(html, width, height);

  if (!result?.uri) {
    throw new Error('The PDF was generated but no file path came back.');
  }

  try {
    const tempInfo = await FileSystem.getInfoAsync(result.uri);
    if (!tempInfo.exists) {
      throw new Error('The print engine did not create a file.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('did not create')) throw e;
    reportError('pdf', e);
  }

  const saved = await saveToDocumentsFolder(result.uri, doc.fileStem, settings.layoutId);
  const printedPages = result.numberOfPages ?? expectedPages;
  if (
    result.numberOfPages != null &&
    expectedPages > 0 &&
    Math.abs(result.numberOfPages - expectedPages) > 1
  ) {
    console.warn(
      `[pdf] page count mismatch: html ${expectedPages}, engine ${result.numberOfPages}`
    );
  }

  return {
    uri: saved.uri,
    savedAs: saved.savedAs,
    bytes: saved.bytes,
    numberOfPages: printedPages,
    document: doc,
    failedImages: failedImages || undefined,
  };
}

export async function sharePdf(uri: string): Promise<void> {
  if (!uri) {
    throw new Error('No PDF to share. On web, use the print dialog and choose “Save as PDF”.');
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error('That PDF file is missing. Generate it again.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('missing')) throw e;
    reportError('pdf', e);
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share product catalogue',
    UTI: 'com.adobe.pdf',
  });
}
