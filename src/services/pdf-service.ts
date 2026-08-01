import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { getCatalogWithPhotos } from '@/db/repository';
import { renderCatalogHtml } from '@/templates';
import {
  pageDimensionsForCatalog,
  type CatalogWithPhotos,
  type PageSize,
} from '@/types/models';

import { toPdfDataUri } from './image-service';

export function pageDimensions(pageSize: PageSize): { width: number; height: number } {
  if (pageSize === 'Letter') return { width: 612, height: 792 };
  return { width: 595, height: 842 };
}

/**
 * Build HTML with every photo inlined as base64 data URI.
 * This is required on iOS and more reliable on Android.
 */
async function buildHtml(catalog: CatalogWithPhotos): Promise<string> {
  // Layout may override page size (e.g. compact square for 2×2)
  const { width, height } = pageDimensionsForCatalog(catalog);
  const cache = new Map<string, string | null>();
  let embedded = 0;
  let failed = 0;

  // Sequential conversion avoids memory spikes from parallel base64 of many photos
  for (const photo of catalog.photos) {
    if (!photo.uri) continue;
    if (cache.has(photo.uri)) continue;
    try {
      const dataUri = await toPdfDataUri(photo.uri);
      if (dataUri?.startsWith('data:')) {
        cache.set(photo.uri, dataUri);
        embedded += 1;
      } else {
        cache.set(photo.uri, null);
        failed += 1;
        console.warn('[pdf] Failed to embed photo', photo.id);
      }
    } catch (e) {
      cache.set(photo.uri, null);
      failed += 1;
      console.warn('[pdf] Error embedding photo', photo.id, e);
    }
  }

  if (embedded === 0 && catalog.photos.length > 0) {
    throw new Error(
      'Could not load any photos for the PDF. Try re-uploading the images, then export again.'
    );
  }

  const resolveImage = (uri: string | null): string | null => {
    if (!uri) return null;
    return cache.get(uri) ?? null;
  };

  const html = renderCatalogHtml({
    catalog,
    photos: catalog.photos,
    resolveImage,
    generatedAt: new Date().toISOString(),
    pageWidth: width,
    pageHeight: height,
  });

  if (__DEV__) {
    console.log(
      `[pdf] HTML built: ${html.length} chars, ${embedded} images, ${failed} failed, page ${width}x${height}`
    );
  }

  return html;
}

export async function buildPreviewHtml(catalogId: string): Promise<string> {
  const catalog = await getCatalogWithPhotos(catalogId);
  if (!catalog) throw new Error('Catalog not found');
  return buildHtml(catalog);
}

/** Open system print dialog on web (Save as PDF). */
async function printHtmlOnWeb(html: string): Promise<{ uri: string; webPrint: true }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF export is only available in a browser or native app.');
  }

  // Write HTML into a hidden iframe and print it
  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'style',
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
  );
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error('Could not open print frame');
  }

  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    // Give images a moment to decode
    setTimeout(() => resolve(), 400);
  });

  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } finally {
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // ignore
      }
    }, 1000);
  }

  return { uri: '', webPrint: true };
}

export async function generatePdf(
  catalogId: string
): Promise<{ uri: string; webPrint?: boolean; numberOfPages?: number }> {
  const catalog = await getCatalogWithPhotos(catalogId);
  if (!catalog) throw new Error('Catalog not found');
  if (!catalog.photos.length) {
    throw new Error('Add at least one photo before exporting.');
  }

  const html = await buildHtml(catalog);
  const { width, height } = pageDimensionsForCatalog(catalog);

  // Web: expo-print only opens window.print() and does not return a file URI
  if (Platform.OS === 'web') {
    return printHtmlOnWeb(html);
  }

  let result: { uri: string; numberOfPages?: number };
  try {
    result = await Print.printToFileAsync({
      html,
      width,
      height,
      // Zero margins — edge-to-edge images (iOS)
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `PDF engine failed: ${msg}. Try fewer photos or a denser layout (3–4 per row).`
    );
  }

  if (!result?.uri) {
    throw new Error('PDF was generated but no file path was returned.');
  }

  // Copy to a stable exports path when possible
  const root = FileSystem.documentDirectory;
  if (root) {
    try {
      const exportsDir = `${root.endsWith('/') ? root : `${root}/`}exports`;
      const info = await FileSystem.getInfoAsync(exportsDir);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(exportsDir, { intermediates: true });
      }
      const safeTitle =
        catalog.title.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 40) || 'catalog';
      const dest = `${exportsDir}/${safeTitle}-${Date.now()}.pdf`;
      await FileSystem.copyAsync({ from: result.uri, to: dest });
      return { uri: dest, numberOfPages: result.numberOfPages };
    } catch {
      return { uri: result.uri, numberOfPages: result.numberOfPages };
    }
  }

  return { uri: result.uri, numberOfPages: result.numberOfPages };
}

export async function sharePdf(uri: string): Promise<void> {
  if (!uri) {
    throw new Error('No PDF file to share. On web, use the browser print dialog and “Save as PDF”.');
  }
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device');
  }

  // Ensure file still exists
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error('PDF file is missing. Generate it again.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('missing')) throw e;
    // getInfoAsync may throw on some URIs — still try share
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share photo catalog PDF',
    UTI: 'com.adobe.pdf',
  });
}
