import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { createId } from '@/lib/id';

const IMAGES_ROOT = 'images';
const BASE64 = 'base64' as const;

function documentRoot(): string | null {
  return FileSystem.documentDirectory ?? null;
}

function cacheRoot(): string | null {
  return FileSystem.cacheDirectory ?? null;
}

export function resolveImageUri(relativeOrAbsolute: string | null | undefined): string | null {
  if (!relativeOrAbsolute) return null;
  if (
    relativeOrAbsolute.startsWith('file://') ||
    relativeOrAbsolute.startsWith('http://') ||
    relativeOrAbsolute.startsWith('https://') ||
    relativeOrAbsolute.startsWith('data:') ||
    relativeOrAbsolute.startsWith('blob:') ||
    relativeOrAbsolute.startsWith('content:') ||
    relativeOrAbsolute.startsWith('ph://') ||
    relativeOrAbsolute.startsWith('assets-library://')
  ) {
    return relativeOrAbsolute;
  }
  const root = documentRoot();
  if (!root) return relativeOrAbsolute;
  // Avoid double slashes
  const base = root.endsWith('/') ? root : `${root}/`;
  const rel = relativeOrAbsolute.replace(/^\//, '');
  return `${base}${rel}`;
}

async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

async function compressImage(
  uri: string,
  maxWidth = 1600,
  compress = 0.82
): Promise<{ uri: string; width?: number; height?: number }> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxWidth } }],
      { compress, format: ImageManipulator.SaveFormat.JPEG }
    );
    return { uri: result.uri, width: result.width, height: result.height };
  } catch {
    return { uri };
  }
}

async function readFileAsBase64(uri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
  } catch {
    // getInfo may fail on some schemes — still try read
  }

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

/**
 * Convert any stored/picked URI into a `data:image/jpeg;base64,...` string.
 * Required for expo-print on iOS (WKWebView cannot load file:// images).
 */
export async function uriToDataUri(uri: string): Promise<string | null> {
  if (!uri) return null;
  if (uri.startsWith('data:')) return uri;

  // Web / remote / blob
  if (
    Platform.OS === 'web' ||
    uri.startsWith('blob:') ||
    uri.startsWith('http://') ||
    uri.startsWith('https://')
  ) {
    const fromBlob = await blobToDataUri(uri);
    if (fromBlob) return fromBlob;
  }

  // Prefer reading through a compressed JPEG in cache (handles content:// better)
  try {
    const compressed = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1400 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
    );
    const b64 = await readFileAsBase64(compressed.uri);
    if (b64) return `data:image/jpeg;base64,${b64}`;
  } catch {
    // continue
  }

  const direct = await readFileAsBase64(uri);
  if (direct) {
    // Guess mime from extension
    const lower = uri.toLowerCase();
    const mime = lower.includes('.png')
      ? 'image/png'
      : lower.includes('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    return `data:${mime};base64,${direct}`;
  }

  // Last resort: fetch (works for some file:// on web-like runtimes)
  const fetched = await blobToDataUri(uri);
  return fetched;
}

export async function toDataUri(
  relativeOrAbsolute: string | null | undefined
): Promise<string | null> {
  const absolute = resolveImageUri(relativeOrAbsolute);
  if (!absolute) return null;
  return uriToDataUri(absolute);
}

/**
 * Prepare a smaller data URI specifically for PDF embedding (memory-safe).
 */
export async function toPdfDataUri(
  relativeOrAbsolute: string | null | undefined
): Promise<string | null> {
  const absolute = resolveImageUri(relativeOrAbsolute);
  if (!absolute) return null;
  if (absolute.startsWith('data:')) {
    // Re-compress data URIs by writing temp file when possible
    try {
      const root = cacheRoot();
      if (root && absolute.includes('base64,')) {
        const raw = absolute.split('base64,')[1];
        const tmp = `${root}pdf-tmp-${createId()}.jpg`;
        await FileSystem.writeAsStringAsync(tmp, raw, { encoding: BASE64 });
        const compressed = await compressImage(tmp, 1000, 0.7);
        const b64 = await readFileAsBase64(compressed.uri);
        if (b64) return `data:image/jpeg;base64,${b64}`;
      }
    } catch {
      // keep original data uri
    }
    return absolute;
  }

  try {
    const compressed = await compressImage(absolute, 1000, 0.7);
    const b64 = await readFileAsBase64(compressed.uri);
    if (b64) return `data:image/jpeg;base64,${b64}`;
  } catch {
    // fall through
  }

  return uriToDataUri(absolute);
}

/**
 * Persist a picked image under the app document directory (native),
 * or as a data URI when the filesystem is unavailable (web).
 */
export async function saveImageAsset(
  sourceUri: string,
  opts: { catalogId: string }
): Promise<{ relativePath: string; width: number | null; height: number | null }> {
  const compressed = await compressImage(sourceUri);
  const root = documentRoot();

  if (Platform.OS === 'web' || !root) {
    const dataUri = await uriToDataUri(compressed.uri);
    if (!dataUri) throw new Error('Could not read image data');
    return {
      relativePath: dataUri,
      width: compressed.width ?? null,
      height: compressed.height ?? null,
    };
  }

  const folder = `${IMAGES_ROOT}/${opts.catalogId}`;
  const absFolder = `${root.endsWith('/') ? root : `${root}/`}${folder}`;
  await ensureDir(absFolder);

  const filename = `${createId()}.jpg`;
  const relativePath = `${folder}/${filename}`;
  const dest = `${absFolder}/${filename}`;

  try {
    await FileSystem.copyAsync({ from: compressed.uri, to: dest });
  } catch {
    try {
      const dataUri = await uriToDataUri(compressed.uri);
      if (!dataUri?.includes('base64,')) throw new Error('no base64');
      const base64 = dataUri.split('base64,')[1];
      await FileSystem.writeAsStringAsync(dest, base64, { encoding: BASE64 });
    } catch {
      const dataUri = await uriToDataUri(compressed.uri);
      if (!dataUri) throw new Error('Failed to save image');
      return {
        relativePath: dataUri,
        width: compressed.width ?? null,
        height: compressed.height ?? null,
      };
    }
  }

  // Verify file was written
  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists) {
    const dataUri = await uriToDataUri(compressed.uri);
    if (!dataUri) throw new Error('Image file missing after save');
    return {
      relativePath: dataUri,
      width: compressed.width ?? null,
      height: compressed.height ?? null,
    };
  }

  return {
    relativePath,
    width: compressed.width ?? null,
    height: compressed.height ?? null,
  };
}

/** Multi-select from library (batch upload). */
export async function pickImages(): Promise<string[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission is required. Enable it in Settings.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    allowsEditing: false,
    quality: 0.9,
    exif: false,
  });

  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map((a) => a.uri).filter(Boolean);
}

export async function takePhoto(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const uris = await pickImages();
    return uris[0] ?? null;
  }
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera permission is required');
  }
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.9,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}

export async function deleteCatalogImageFolder(catalogId: string): Promise<void> {
  const root = documentRoot();
  if (!root) return;
  try {
    const path = `${root.endsWith('/') ? root : `${root}/`}${IMAGES_ROOT}/${catalogId}`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch {
    // best-effort
  }
}

/**
 * Load pixel size of an image (for crop math).
 */
export async function getImageSize(
  uri: string
): Promise<{ width: number; height: number }> {
  const absolute = resolveImageUri(uri) ?? uri;
  // manipulate with empty actions returns dimensions on most platforms
  try {
    const result = await ImageManipulator.manipulateAsync(absolute, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (result.width && result.height) {
      return { width: result.width, height: result.height };
    }
  } catch {
    // fall through
  }
  throw new Error('Could not read image size');
}

/**
 * Crop image to a rect and save into the catalog folder (or data URI on web).
 */
export async function cropAndSaveImage(
  sourceUri: string,
  crop: { originX: number; originY: number; width: number; height: number },
  opts: { catalogId: string }
): Promise<{ relativePath: string; width: number; height: number }> {
  const absolute = resolveImageUri(sourceUri) ?? sourceUri;

  const cropped = await ImageManipulator.manipulateAsync(
    absolute,
    [
      {
        crop: {
          originX: Math.max(0, Math.round(crop.originX)),
          originY: Math.max(0, Math.round(crop.originY)),
          width: Math.max(1, Math.round(crop.width)),
          height: Math.max(1, Math.round(crop.height)),
        },
      },
      // Keep a sensible max edge for PDF
      { resize: { width: 1600 } },
    ],
    { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG }
  );

  const root = documentRoot();
  if (Platform.OS === 'web' || !root) {
    const dataUri = await uriToDataUri(cropped.uri);
    if (!dataUri) throw new Error('Could not save cropped image');
    return {
      relativePath: dataUri,
      width: cropped.width,
      height: cropped.height,
    };
  }

  const folder = `${IMAGES_ROOT}/${opts.catalogId}`;
  const absFolder = `${root.endsWith('/') ? root : `${root}/`}${folder}`;
  await ensureDir(absFolder);
  const filename = `crop-${createId()}.jpg`;
  const relativePath = `${folder}/${filename}`;
  const destPath = `${absFolder}/${filename}`;

  try {
    await FileSystem.copyAsync({ from: cropped.uri, to: destPath });
  } catch {
    const dataUri = await uriToDataUri(cropped.uri);
    if (!dataUri?.includes('base64,')) throw new Error('Failed to write crop');
    await FileSystem.writeAsStringAsync(destPath, dataUri.split('base64,')[1], {
      encoding: BASE64,
    });
  }

  return {
    relativePath,
    width: cropped.width,
    height: cropped.height,
  };
}
