import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { effectiveCrop } from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { renderCatalogHtml } from '@/templates';
import {
  gridCellSize,
  hasContactDetails,
  pageDimensions,
  rotatedSize,
  type BrandContact,
  type CatalogDocument,
  type CatalogScope,
  type ExportSettings,
  type Product,
} from '@/types/models';

import { buildCatalogDocument } from './catalog-document';
import { toPdfDataUri } from './image-service';

/**
 * Every product image is inlined as base64, so a big catalogue becomes one
 * enormous HTML string. Handing 40 MB+ of markup to the print engine or the
 * preview WebView reliably kills the native process — an app that vanishes
 * with nothing in the JS logs. These caps turn that into a readable error.
 *
 * The preview is the tighter of the two: it is a convenience, and the export
 * itself should still be attemptable when the preview is too heavy.
 */
const MAX_PREVIEW_BYTES = 24 * 1024 * 1024;
const MAX_EXPORT_BYTES = 48 * 1024 * 1024;

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Fail loudly, and with advice, before the native side runs out of memory. */
function assertWithinBudget(html: string, limit: number, what: 'preview' | 'export'): void {
  // Base64 is ASCII, so one character is one byte — close enough to measure by.
  const size = html.length;
  if (size <= limit) return;

  const advice =
    'Choose a denser layout (3 or 4 per row), switch to a single company or formula, or turn off the cover and label pages.';
  throw new Error(
    what === 'preview'
      ? `This catalogue is too large to preview (${megabytes(size)}). ${advice}`
      : `This catalogue is too large to export in one file (${megabytes(size)}). ${advice}`
  );
}

export type GenerateResult = {
  uri: string;
  /** Web has no file to share — the browser print dialog was opened instead. */
  webPrint?: boolean;
  numberOfPages?: number;
  document: CatalogDocument;
};

/**
 * Print resolution multiplier over the cell's point size. Anything beyond this
 * is detail the page cannot show, paid for in megabytes.
 */
const CELL_PIXEL_DENSITY = 2.5;

/** Cell geometry the images have to be rendered for. */
function targetCell(settings: ExportSettings, contact: BrandContact) {
  const cell = gridCellSize({
    layoutId: settings.layoutId,
    pageSize: settings.pageSize,
    contactBox: settings.includeContactBox && hasContactDetails(contact),
  });
  return {
    aspect: cell.width / cell.height,
    maxWidth: Math.ceil(cell.width * CELL_PIXEL_DENSITY),
  };
}

/**
 * Inline every product image as a base64 data URI. Required on iOS (WKWebView
 * refuses `file://` sources) and far more reliable on Android.
 *
 * Each image is cropped to this layout's cell before being encoded, so the
 * catalogue carries only the pixels it prints. The key includes the crop
 * because two products can share a path but not a framing.
 */
/**
 * How many images are encoded at once. Native image work is off the JS thread,
 * so a small pool is a large speed-up; going wider mostly buys peak memory,
 * which is the one thing that reliably kills the export.
 */
const ENCODE_CONCURRENCY = 4;

/**
 * Encoded images, surviving between exports.
 *
 * The bytes are fully determined by the image, its framing and the cell it is
 * being rendered into, so re-exporting an unchanged catalogue can skip the
 * work entirely. Bounded because the entries are whole base64 images.
 */
const encodeCache = new Map<string, string>();
const ENCODE_CACHE_LIMIT = 400;

function cacheGet(key: string): string | undefined {
  const hit = encodeCache.get(key);
  if (hit === undefined) return undefined;
  // Re-insert so the most recently used entries survive the trim.
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
  cell: { aspect: number; maxWidth: number }
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  let failed = 0;

  // Deduplicate first: the same product can appear under several sections.
  const pending = new Map<string, Product>();
  let fromCache = 0;
  for (const section of doc.sections) {
    for (const product of section.products) {
      const key = imageKey(product, cell);
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

      // The stored dimensions are of the upright master; the crop was drawn
      // against the rotated frame, so it has to be resolved in that space.
      const crop = effectiveCrop(
        product.crop,
        product.width && product.height
          ? rotatedSize({ width: product.width, height: product.height }, product.rotation)
          : null,
        cell.aspect
      );

      try {
        const dataUri = await toPdfDataUri(product.imageUri, {
          rotation: product.rotation,
          crop,
          maxWidth: cell.maxWidth,
        });
        if (dataUri?.startsWith('data:')) {
          resolved.set(key, dataUri);
          cachePut(key, dataUri);
        } else {
          failed += 1;
          console.warn('[pdf] Could not embed image for product', product.id);
        }
      } catch (e) {
        failed += 1;
        reportError('pdf', e);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ENCODE_CONCURRENCY, jobs.length) }, worker)
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

  return resolved;
}

/**
 * Identity of the rendered bytes. Everything that changes a pixel goes in:
 * the path, the framing, the angle, and the cell being filled — which is why
 * the same key is safe to reuse as a cache key across exports.
 */
function imageKey(product: Product, cell: { aspect: number; maxWidth: number }): string | null {
  if (!product.imageUri) return null;
  const c = product.crop;
  const frame = c
    ? `${c.x.toFixed(4)},${c.y.toFixed(4)},${c.w.toFixed(4)},${c.h.toFixed(4)}`
    : 'full';
  return [
    product.imageUri,
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
): Promise<string> {
  const { width, height } = pageDimensions(settings);
  const cell = targetCell(settings, contact);
  const cache = await embedImages(doc, cell);

  const html = renderCatalogHtml({
    document: doc,
    settings,
    contact,
    resolveImage: (product) => {
      const key = imageKey(product, cell);
      return key ? (cache.get(key) ?? null) : null;
    },
    pageWidth: width,
    pageHeight: height,
  });

  if (__DEV__) {
    console.log(
      `[pdf] ${doc.sections.length} section(s), ${doc.productCount} product(s), ` +
        `${cache.size} image(s), ${html.length} chars, page ${width}×${height}`
    );
  }

  return html;
}

function assertPrintable(doc: CatalogDocument): void {
  if (!doc.productCount || !doc.sections.length) {
    throw new Error('There are no products in this selection yet. Add one and try again.');
  }
}

/** Exact page count, read back from the markup the renderer produced. */
function countPages(html: string): number {
  return (html.match(/class="page"/g) ?? []).length;
}

/** HTML for the on-device preview — the same document the export produces. */
export async function buildPreviewHtml(
  scope: CatalogScope,
  settings: ExportSettings,
  contact: BrandContact
): Promise<{ html: string; document: CatalogDocument; pageCount: number }> {
  const doc = await buildCatalogDocument(scope);
  assertPrintable(doc);
  const html = await buildHtml(doc, settings, contact);
  assertWithinBudget(html, MAX_PREVIEW_BYTES, 'preview');
  return { html, document: doc, pageCount: countPages(html) };
}

/** Open the system print dialog on web (the user picks "Save as PDF"). */
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

  // Give the embedded images a moment to decode before printing.
  await new Promise<void>((resolve) => setTimeout(resolve, 400));

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

/** Copy the generated file somewhere stable, so sharing later still works. */
async function moveToExports(sourceUri: string, fileStem: string): Promise<string> {
  const root = FileSystem.documentDirectory;
  if (!root) return sourceUri;

  try {
    const exportsDir = `${root.endsWith('/') ? root : `${root}/`}exports`;
    const info = await FileSystem.getInfoAsync(exportsDir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(exportsDir, { intermediates: true });
    }
    const dest = `${exportsDir}/${fileStem}-${Date.now()}.pdf`;
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    return dest;
  } catch (e) {
    // The cache copy is a nicety — the freshly printed file still works.
    reportError('pdf', e);
    return sourceUri;
  }
}

export async function generatePdf(
  scope: CatalogScope,
  settings: ExportSettings,
  contact: BrandContact
): Promise<GenerateResult> {
  const doc = await buildCatalogDocument(scope);
  assertPrintable(doc);

  const html = await buildHtml(doc, settings, contact);
  assertWithinBudget(html, MAX_EXPORT_BYTES, 'export');
  const { width, height } = pageDimensions(settings);

  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return { uri: '', webPrint: true, document: doc };
  }

  let result: { uri: string; numberOfPages?: number };
  try {
    result = await Print.printToFileAsync({
      html,
      width,
      height,
      // Zero margins — the image grid runs edge to edge.
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } catch (e) {
    reportError('pdf', e);
    throw new Error(
      `PDF engine failed: ${toMessage(e)}. Try a denser layout (3–4 per row) or a narrower selection.`
    );
  }

  if (!result?.uri) {
    throw new Error('The PDF was generated but no file path came back.');
  }

  return {
    uri: await moveToExports(result.uri, doc.fileStem),
    numberOfPages: result.numberOfPages,
    document: doc,
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
    // getInfoAsync can throw on some URI schemes — still worth trying to share.
    reportError('pdf', e);
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share product catalogue',
    UTI: 'com.adobe.pdf',
  });
}
