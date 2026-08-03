import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { PixelRect } from '@/lib/crop-geometry';
import { createId } from '@/lib/id';
import type { Rotation } from '@/types/models';

const IMAGES_ROOT = 'images';
const PRODUCTS_FOLDER = `${IMAGES_ROOT}/products`;
const BASE64 = 'base64' as const;

/** Longest edge kept on disk — plenty for print, small enough to stay fast. */
const STORED_MAX_WIDTH = 1600;
const STORED_QUALITY = 0.85;
/** Upper bound when embedding into PDF HTML, to keep memory in check. */
const PDF_MAX_WIDTH = 1100;
const PDF_QUALITY = 0.72;

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
  opts: { rotation?: Rotation; crop?: PixelRect | null; maxWidth?: number } = {}
): Promise<ImageRef> {
  const context = ImageManipulator.manipulate(source);
  // Rotation runs first: a crop is always expressed against the upright image,
  // which is what the editor showed when the rect was drawn.
  if (opts.rotation) {
    context.rotate(opts.rotation);
  }
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
  opts: {
    rotation?: Rotation;
    crop?: PixelRect | null;
    maxWidth?: number;
    compress: number;
    base64?: boolean;
  }
) {
  const ref = await renderImage(source, {
    rotation: opts.rotation,
    crop: opts.crop,
    maxWidth: opts.maxWidth,
  });
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
 *
 * `crop` is the rect derived for the grid cell this image will fill, so the
 * bytes that reach the PDF are already cell-shaped and the stylesheet's
 * `object-fit: cover` has nothing left to trim. `maxWidth` should be the cell
 * width in device pixels — a 4-per-row cell is under 300px wide, and sending
 * 1100px there was most of why dense grids blew the size budget.
 */
export async function toPdfDataUri(
  relativeOrAbsolute: string | null | undefined,
  opts: { rotation?: Rotation; crop?: PixelRect | null; maxWidth?: number } = {}
): Promise<string | null> {
  const absolute = resolveImageUri(relativeOrAbsolute);
  if (!absolute) return null;

  const maxWidth = Math.max(1, Math.min(opts.maxWidth ?? PDF_MAX_WIDTH, PDF_MAX_WIDTH));

  try {
    const result = await renderAndSave(absolute, {
      rotation: opts.rotation,
      crop: opts.crop ?? undefined,
      maxWidth,
      compress: PDF_QUALITY,
      base64: true,
    });
    if (result.base64) return `data:image/jpeg;base64,${result.base64}`;
  } catch {
    // A crop that the manipulator rejects must not lose the image entirely —
    // the uncropped frame still prints, just centre-cropped by the cell.
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

/**
 * Compress a picked image and store it in the app's product image folder.
 *
 * This is the master: the full frame, never cropped. Cropping is a rect stored
 * alongside the product and applied when rendering, so re-framing a shot for a
 * different grid always starts from these pixels rather than from the last
 * crop's leftovers.
 */
export async function saveProductImage(
  sourceUri: string,
  opts: { alreadyNormalized?: { width: number; height: number } } = {}
): Promise<SavedImage> {
  // Import already re-encodes to bake in EXIF orientation. Doing it again here
  // would put a second round of JPEG loss on every photo for no benefit, so a
  // known-normalised file is just moved into place.
  if (opts.alreadyNormalized) {
    return persist({ uri: sourceUri, ...opts.alreadyNormalized }, '');
  }

  const produced = await renderAndSave(sourceUri, {
    maxWidth: STORED_MAX_WIDTH,
    compress: STORED_QUALITY,
  });
  return persist(produced, '');
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

/**
 * Re-encode a freshly picked image so its pixels stand on their own.
 *
 * Camera files carry an EXIF orientation flag: `<Image>` honours it, but the
 * manipulator reports the raw buffer's dimensions. On a portrait phone photo
 * those disagree by a quarter turn, so the crop editor would draw its frame
 * against a picture rotated from the one on screen and save the wrong region.
 * Rendering once up front bakes the orientation in and makes the two agree.
 */
export async function normalizeImportedImage(
  sourceUri: string
): Promise<{ uri: string; width: number; height: number }> {
  const produced = await renderAndSave(sourceUri, {
    maxWidth: STORED_MAX_WIDTH,
    compress: STORED_QUALITY,
  });
  return { uri: produced.uri, width: produced.width, height: produced.height };
}

/**
 * A copy of the image turned to `rotation`, for the crop editor to work on.
 *
 * The editor needs to *show* the rotation while still drawing its frame in
 * plain upright coordinates. Rendering a temporary rotated copy gives it both;
 * the stored product keeps the original file and the angle as data.
 */
export async function renderRotatedCopy(
  sourceUri: string,
  rotation: Rotation
): Promise<{ uri: string; width: number; height: number }> {
  const absolute = resolveImageUri(sourceUri) ?? sourceUri;
  if (!rotation) {
    const size = await getImageSize(absolute);
    return { uri: absolute, ...size };
  }
  const produced = await renderAndSave(absolute, {
    rotation,
    maxWidth: STORED_MAX_WIDTH,
    compress: STORED_QUALITY,
  });
  return { uri: produced.uri, width: produced.width, height: produced.height };
}

/**
 * Tiny data URI for the auto-trim scan. A bounding box needs shape, not
 * detail, and keeping it small keeps the whole scan under a frame or two.
 */
export async function toProbeDataUri(
  uri: string,
  opts: { rotation?: Rotation; maxEdge: number }
): Promise<string | null> {
  const absolute = resolveImageUri(uri) ?? uri;
  try {
    const result = await renderAndSave(absolute, {
      rotation: opts.rotation,
      maxWidth: opts.maxEdge,
      compress: 0.8,
      base64: true,
    });
    return result.base64 ? `data:image/jpeg;base64,${result.base64}` : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Storage accounting                                                          */
/* -------------------------------------------------------------------------- */

/** Absolute path of the folder holding product images, or null on web. */
function productsFolder(): string | null {
  const root = documentRoot();
  return root ? `${withTrailingSlash(root)}${PRODUCTS_FOLDER}` : null;
}

/** Every file currently sitting in the product image folder. */
export async function listStoredImageFiles(): Promise<string[]> {
  const folder = productsFolder();
  if (!folder) return [];
  try {
    const info = await FileSystem.getInfoAsync(folder);
    if (!info.exists) return [];
    const names = await FileSystem.readDirectoryAsync(folder);
    return names.map((name) => `${PRODUCTS_FOLDER}/${name}`);
  } catch {
    return [];
  }
}

/** Total bytes used by the given stored paths. */
export async function measureImageBytes(relativePaths: string[]): Promise<number> {
  let total = 0;
  for (const path of relativePaths) {
    const absolute = resolveImageUri(path);
    if (!absolute || !absolute.startsWith('file://')) continue;
    try {
      const info = await FileSystem.getInfoAsync(absolute);
      if (info.exists && !info.isDirectory) total += info.size ?? 0;
    } catch {
      // An unreadable file simply does not count towards the total.
    }
  }
  return total;
}

/** Bytes held by generated PDFs, which are only ever a cache. */
export async function measureExportBytes(): Promise<{ bytes: number; folder: string | null }> {
  const root = documentRoot();
  if (!root) return { bytes: 0, folder: null };
  const folder = `${withTrailingSlash(root)}exports`;
  try {
    const info = await FileSystem.getInfoAsync(folder);
    if (!info.exists) return { bytes: 0, folder };
    const names = await FileSystem.readDirectoryAsync(folder);
    let total = 0;
    for (const name of names) {
      const file = await FileSystem.getInfoAsync(`${folder}/${name}`);
      if (file.exists && !file.isDirectory) total += file.size ?? 0;
    }
    return { bytes: total, folder };
  } catch {
    return { bytes: 0, folder };
  }
}

export async function deleteFolderContents(folder: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(folder);
    if (!info.exists) return;
    const names = await FileSystem.readDirectoryAsync(folder);
    for (const name of names) {
      await FileSystem.deleteAsync(`${folder}/${name}`, { idempotent: true });
    }
  } catch {
    // Reclaiming cache is best effort — never fail the screen over it.
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
