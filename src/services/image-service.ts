import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { createId } from '@/lib/id';

const IMAGES_ROOT = 'images';
const PRODUCTS_FOLDER = `${IMAGES_ROOT}/products`;
const BASE64 = 'base64' as const;

/** Longest edge kept on disk — plenty for print, small enough to stay fast. */
const STORED_MAX_WIDTH = 1600;
const STORED_QUALITY = 0.85;
/** Downscale used when embedding into PDF HTML, to keep memory in check. */
const PDF_MAX_WIDTH = 1100;
const PDF_QUALITY = 0.72;

export type CropRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type SavedImage = {
  /** Path stored in the database — relative on native, a data URI on web. */
  relativePath: string;
  width: number | null;
  height: number | null;
};

function documentRoot(): string | null {
  return FileSystem.documentDirectory ?? null;
}

function withTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

const REMOTE_SCHEMES = [
  'file://',
  'http://',
  'https://',
  'data:',
  'blob:',
  'content:',
  'ph://',
  'assets-library://',
];

/** Turn a stored path into something an <Image> or the manipulator can open. */
export function resolveImageUri(relativeOrAbsolute: string | null | undefined): string | null {
  if (!relativeOrAbsolute) return null;
  if (REMOTE_SCHEMES.some((scheme) => relativeOrAbsolute.startsWith(scheme))) {
    return relativeOrAbsolute;
  }
  const root = documentRoot();
  if (!root) return relativeOrAbsolute;
  return `${withTrailingSlash(root)}${relativeOrAbsolute.replace(/^\//, '')}`;
}

async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Manipulation (expo-image-manipulator contextual API)                        */
/* -------------------------------------------------------------------------- */

/**
 * Render an image with an optional crop, downscaling only when the result is
 * wider than `maxWidth` — resizing unconditionally would upscale small pack
 * shots and cost bytes for no extra detail.
 *
 * The returned ref owns native memory: callers must `release()` it.
 */
async function renderImage(
  source: string,
  opts: { crop?: CropRect; maxWidth?: number } = {}
): Promise<ImageRef> {
  const context = ImageManipulator.manipulate(source);
  if (opts.crop) {
    context.crop({
      originX: Math.max(0, Math.round(opts.crop.originX)),
      originY: Math.max(0, Math.round(opts.crop.originY)),
      width: Math.max(1, Math.round(opts.crop.width)),
      height: Math.max(1, Math.round(opts.crop.height)),
    });
  }

  const rendered = await context.renderAsync();
  if (!opts.maxWidth || rendered.width <= opts.maxWidth) return rendered;

  // Chaining from the rendered ref avoids decoding the source file twice.
  try {
    return await ImageManipulator.manipulate(rendered).resize({ width: opts.maxWidth }).renderAsync();
  } finally {
    rendered.release();
  }
}

async function renderAndSave(
  source: string,
  opts: { crop?: CropRect; maxWidth?: number; compress: number; base64?: boolean }
) {
  const ref = await renderImage(source, { crop: opts.crop, maxWidth: opts.maxWidth });
  try {
    return await ref.saveAsync({
      compress: opts.compress,
      format: SaveFormat.JPEG,
      base64: opts.base64,
    });
  } finally {
    ref.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Reading images as data URIs (required by expo-print)                        */
/* -------------------------------------------------------------------------- */

async function readFileAsBase64(uri: string): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: BASE64 });
  } catch {
    return null;
  }
}

async function blobToDataUri(uri: string): Promise<string | null> {
  try {
    const res = await fetch(uri);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string' && result.startsWith('data:')) resolve(result);
        else reject(new Error('Invalid data URL'));
      };
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function guessMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Convert any stored/picked URI into a `data:image/jpeg;base64,…` string.
 * WKWebView (used by expo-print on iOS) cannot load `file://` images, so every
 * picture must be inlined before printing.
 */
export async function uriToDataUri(uri: string): Promise<string | null> {
  if (!uri) return null;
  if (uri.startsWith('data:')) return uri;

  try {
    const result = await renderAndSave(uri, { compress: 0.9, base64: true });
    if (result.base64) return `data:image/jpeg;base64,${result.base64}`;
  } catch {
    // fall through to direct reads
  }

  const direct = await readFileAsBase64(uri);
  if (direct) return `data:${guessMime(uri)};base64,${direct}`;

  return blobToDataUri(uri);
}

/**
 * Data URI sized for PDF embedding. Every product image in a catalog goes
 * through this, so it trades a little resolution for a much smaller document.
 */
export async function toPdfDataUri(
  relativeOrAbsolute: string | null | undefined
): Promise<string | null> {
  const absolute = resolveImageUri(relativeOrAbsolute);
  if (!absolute) return null;

  try {
    const result = await renderAndSave(absolute, {
      maxWidth: PDF_MAX_WIDTH,
      compress: PDF_QUALITY,
      base64: true,
    });
    if (result.base64) return `data:image/jpeg;base64,${result.base64}`;
  } catch {
    // fall through
  }

  return uriToDataUri(absolute);
}

/* -------------------------------------------------------------------------- */
/* Persisting product images                                                   */
/* -------------------------------------------------------------------------- */

async function persist(
  produced: { uri: string; width: number; height: number },
  filenamePrefix: string
): Promise<SavedImage> {
  const root = documentRoot();

  // Web has no document directory — keep the bytes inline in the database.
  if (Platform.OS === 'web' || !root) {
    const dataUri = await uriToDataUri(produced.uri);
    if (!dataUri) throw new Error('Could not read the selected image.');
    return { relativePath: dataUri, width: produced.width, height: produced.height };
  }

  const absFolder = `${withTrailingSlash(root)}${PRODUCTS_FOLDER}`;
  await ensureDir(absFolder);

  const filename = `${filenamePrefix}${createId()}.jpg`;
  const relativePath = `${PRODUCTS_FOLDER}/${filename}`;
  const dest = `${absFolder}/${filename}`;

  try {
    await FileSystem.copyAsync({ from: produced.uri, to: dest });
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists) throw new Error('Image file missing after copy');
  } catch {
    // Some URIs cannot be copied directly — write the decoded bytes instead.
    const dataUri = await uriToDataUri(produced.uri);
    const base64 = dataUri?.split('base64,')[1];
    if (!base64) throw new Error('Could not save the image to this device.');
    await FileSystem.writeAsStringAsync(dest, base64, { encoding: BASE64 });
  }

  return { relativePath, width: produced.width, height: produced.height };
}

/** Compress a picked image and store it in the app's product image folder. */
export async function saveProductImage(sourceUri: string): Promise<SavedImage> {
  const produced = await renderAndSave(sourceUri, {
    maxWidth: STORED_MAX_WIDTH,
    compress: STORED_QUALITY,
  });
  return persist(produced, '');
}

/** Crop an existing product image and store the result as a new file. */
export async function cropProductImage(
  sourceUri: string,
  crop: CropRect
): Promise<SavedImage> {
  const absolute = resolveImageUri(sourceUri) ?? sourceUri;
  const produced = await renderAndSave(absolute, {
    crop,
    maxWidth: STORED_MAX_WIDTH,
    compress: 0.88,
  });
  return persist(produced, 'crop-');
}

/** Pixel size of an image, used by the crop editor's transform maths. */
export async function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  const absolute = resolveImageUri(uri) ?? uri;
  const ref = await renderImage(absolute);
  try {
    if (!ref.width || !ref.height) throw new Error('Could not read image size');
    return { width: ref.width, height: ref.height };
  } finally {
    ref.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                     */
/* -------------------------------------------------------------------------- */

/** Best-effort removal of a stored image. Data URIs live in the row itself. */
export async function deleteImageFile(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath || relativePath.startsWith('data:')) return;
  const absolute = resolveImageUri(relativePath);
  if (!absolute || !absolute.startsWith('file://')) return;
  try {
    await FileSystem.deleteAsync(absolute, { idempotent: true });
  } catch {
    // A leftover file is harmless — never fail a delete over it.
  }
}

export async function deleteImageFiles(paths: (string | null | undefined)[]): Promise<void> {
  for (const path of paths) {
    await deleteImageFile(path);
  }
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

export async function pickImage(): Promise<string | null> {
  const [uri] = await pickImages({ multiple: false });
  return uri ?? null;
}

export async function pickImages(opts?: { multiple?: boolean }): Promise<string[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission is required. Enable it in Settings.');
  }

  const multiple = opts?.multiple ?? true;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 0 : 1,
    allowsEditing: false,
    quality: 0.9,
    exif: false,
  });

  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map((asset) => asset.uri).filter(Boolean);
}

export async function takePhoto(): Promise<string | null> {
  if (Platform.OS === 'web') return pickImage();

  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera permission is required.');
  }
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.9,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}
