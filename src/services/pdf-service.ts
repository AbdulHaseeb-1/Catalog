import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { renderCatalogHtml } from '@/templates';
import {
  pageDimensions,
  type BrandContact,
  type CatalogDocument,
  type CatalogScope,
  type ExportSettings,
} from '@/types/models';

import { buildCatalogDocument } from './catalog-document';
import { toPdfDataUri } from './image-service';

export type GenerateResult = {
  uri: string;
  /** Web has no file to share — the browser print dialog was opened instead. */
  webPrint?: boolean;
  numberOfPages?: number;
  document: CatalogDocument;
};

/**
 * Inline every product image as a base64 data URI. Required on iOS (WKWebView
 * refuses `file://` sources) and far more reliable on Android.
 */
async function embedImages(doc: CatalogDocument): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const seen = new Set<string>();
  let failed = 0;

  for (const section of doc.sections) {
    for (const product of section.products) {
      const uri = product.imageUri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      try {
        const dataUri = await toPdfDataUri(uri);
        if (dataUri?.startsWith('data:')) {
          cache.set(uri, dataUri);
        } else {
          failed += 1;
          console.warn('[pdf] Could not embed image for product', product.id);
        }
      } catch (e) {
        failed += 1;
        console.warn('[pdf] Error embedding image for product', product.id, e);
      }
    }
  }

  if (cache.size === 0 && seen.size > 0) {
    throw new Error(
      'None of the product images could be read. Re-add the images, then export again.'
    );
  }

  if (__DEV__ && failed) {
    console.warn(`[pdf] ${failed} image(s) could not be embedded`);
  }

  return cache;
}

async function buildHtml(
  doc: CatalogDocument,
  settings: ExportSettings,
  contact: BrandContact
): Promise<string> {
  const { width, height } = pageDimensions(settings);
  const cache = await embedImages(doc);

  const html = renderCatalogHtml({
    document: doc,
    settings,
    contact,
    resolveImage: (uri) => (uri ? (cache.get(uri) ?? null) : null),
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
  } catch {
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
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `PDF engine failed: ${msg}. Try a denser layout (3–4 per row) or a narrower selection.`
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
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share product catalogue',
    UTI: 'com.adobe.pdf',
  });
}
