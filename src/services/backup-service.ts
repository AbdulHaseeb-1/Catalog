import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { readAllRows, replaceAllRows, type BackupTables } from '@/db/backup';
import * as repo from '@/db/repository';
import { reportError } from '@/lib/errors';
import type { BrandContact, ExportSettings } from '@/types/models';

import { resolveImageUri, uriToDataUri } from './image-service';

/**
 * Backup format: newline-delimited JSON, one record per line.
 *
 * The whole catalogue lives in one SQLite file and a folder of JPEGs on one
 * device — losing the phone loses everything, and PDFs are not a way back.
 *
 * Images can run to tens of megabytes, so neither writing nor reading ever
 * holds the whole archive in memory: lines are appended one at a time, and
 * read back through a positional chunk reader. Every line is written as pure
 * ASCII so a chunk can be split on byte boundaries without cutting a
 * multi-byte character in half.
 */
export const BACKUP_VERSION = 1;
const BACKUP_EXTENSION = 'catalogbak';
const READ_CHUNK_BYTES = 512 * 1024;

type MetaLine = {
  kind: 'meta';
  version: number;
  createdAt: string;
  counts: { companies: number; formulas: number; products: number; images: number };
};

type Line =
  | MetaLine
  | { kind: 'settings'; exportSettings: ExportSettings; brandContact: BrandContact }
  | { kind: 'companies'; rows: unknown[] }
  | { kind: 'formulas'; rows: unknown[] }
  | { kind: 'products'; rows: unknown[] }
  | { kind: 'image'; path: string; dataUri: string };

/**
 * JSON escaped down to plain ASCII. Every byte in the file is then below
 * 0x80, so a positional read can be cut anywhere without splitting a
 * character in half.
 */
function asciiLine(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  const escaped = json.replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
  return `${escaped}\n`;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Base64 → the ASCII text it encodes. The file is read positionally as base64
 * because that is the only chunked read the file system offers, and `atob` is
 * not something to rely on across engines.
 */
function decodeBase64Ascii(input: string): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const code = B64_LOOKUP[input.charCodeAt(i)];
    if (code === 255) continue; // padding, newlines, whitespace
    buffer = (buffer << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function backupsFolder(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root.endsWith('/') ? root : `${root}/`}backups`;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export type BackupResult = { uri: string; bytes: number; products: number; images: number };

export async function createBackup(
  settings: ExportSettings,
  contact: BrandContact,
  onProgress?: (done: number, total: number) => void
): Promise<BackupResult> {
  const folder = backupsFolder();
  if (!folder) {
    throw new Error('Backups need on-device storage, which this platform does not provide.');
  }

  const info = await FileSystem.getInfoAsync(folder);
  if (!info.exists) await FileSystem.makeDirectoryAsync(folder, { intermediates: true });

  const tables = await readAllRows();
  const paths = await repo.listReferencedImagePaths();
  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${folder}/catalog-${stamp}-${Date.now()}.${BACKUP_EXTENSION}`;

  const meta: MetaLine = {
    kind: 'meta',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    counts: {
      companies: tables.companies.length,
      formulas: tables.formulas.length,
      products: tables.products.length,
      images: paths.length,
    },
  };

  // First write replaces any previous file at this path; the rest append.
  await FileSystem.writeAsStringAsync(uri, asciiLine(meta));
  const append = (line: Line) =>
    FileSystem.writeAsStringAsync(uri, asciiLine(line), { append: true });

  await append({ kind: 'settings', exportSettings: settings, brandContact: contact });
  await append({ kind: 'companies', rows: tables.companies });
  await append({ kind: 'formulas', rows: tables.formulas });
  await append({ kind: 'products', rows: tables.products });

  let images = 0;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    try {
      // Data URIs are already inline (web), so they are stored as-is.
      const dataUri = path.startsWith('data:')
        ? path
        : await uriToDataUri(resolveImageUri(path) ?? path);
      if (dataUri) {
        await append({ kind: 'image', path, dataUri });
        images += 1;
      }
    } catch (e) {
      // A photo that cannot be read must not cost the user the whole backup.
      reportError('backup', e);
    }
    onProgress?.(i + 1, paths.length);
  }

  const written = await FileSystem.getInfoAsync(uri);
  return {
    uri,
    bytes: written.exists ? (written.size ?? 0) : 0,
    products: tables.products.length,
    images,
  };
}

export async function shareBackup(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Save catalogue backup',
  });
}

/** Backups kept on the device, newest first. */
export async function listLocalBackups(): Promise<{ uri: string; name: string }[]> {
  const folder = backupsFolder();
  if (!folder) return [];
  try {
    const info = await FileSystem.getInfoAsync(folder);
    if (!info.exists) return [];
    const names = await FileSystem.readDirectoryAsync(folder);
    return names
      .filter((name) => name.endsWith(`.${BACKUP_EXTENSION}`))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => ({ uri: `${folder}/${name}`, name }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Yield the archive one line at a time, never holding more than a chunk. */
async function* readLines(uri: string): AsyncGenerator<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('That backup file could not be opened.');
  const size = info.size ?? 0;

  let position = 0;
  let buffer = '';

  while (position < size) {
    const length = Math.min(READ_CHUNK_BYTES, size - position);
    const chunk = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
      position,
      length,
    });
    position += length;
    buffer += decodeBase64Ascii(chunk);

    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) yield line;
      newline = buffer.indexOf('\n');
    }
  }

  if (buffer.trim()) yield buffer;
}

export type RestoreSummary = {
  companies: number;
  formulas: number;
  products: number;
  images: number;
  settings?: { exportSettings: ExportSettings; brandContact: BrandContact };
};

export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    // Most providers will not report a custom extension as a known MIME type.
    type: '*/*',
  });
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
}

/**
 * Rebuild the library from a backup. The database is replaced in a single
 * transaction only after every image has been written back to disk, so a
 * failure mid-restore leaves the current catalogue intact.
 */
export async function restoreBackup(
  uri: string,
  onProgress?: (stage: string, done: number, total: number) => void
): Promise<RestoreSummary> {
  const tables: BackupTables = { companies: [], formulas: [], products: [] };
  let settings: RestoreSummary['settings'];
  let meta: MetaLine | null = null;
  let images = 0;

  const root = FileSystem.documentDirectory;
  const imagesFolder = root
    ? `${root.endsWith('/') ? root : `${root}/`}images/products`
    : null;
  if (imagesFolder) {
    const folderInfo = await FileSystem.getInfoAsync(imagesFolder);
    if (!folderInfo.exists) {
      await FileSystem.makeDirectoryAsync(imagesFolder, { intermediates: true });
    }
  }

  for await (const line of readLines(uri)) {
    let record: Line;
    try {
      record = JSON.parse(line) as Line;
    } catch {
      // A single corrupt line should not abandon an otherwise good archive.
      continue;
    }

    switch (record.kind) {
      case 'meta':
        meta = record;
        if (record.version > BACKUP_VERSION) {
          throw new Error(
            'This backup was made by a newer version of the app. Update, then restore.'
          );
        }
        break;
      case 'settings':
        settings = {
          exportSettings: record.exportSettings,
          brandContact: record.brandContact,
        };
        break;
      case 'companies':
        tables.companies = record.rows as BackupTables['companies'];
        break;
      case 'formulas':
        tables.formulas = record.rows as BackupTables['formulas'];
        break;
      case 'products':
        tables.products = record.rows as BackupTables['products'];
        break;
      case 'image': {
        const base64 = record.dataUri.split('base64,')[1];
        if (!base64 || !imagesFolder || record.path.startsWith('data:')) break;
        const absolute = resolveImageUri(record.path);
        if (!absolute) break;
        try {
          await FileSystem.writeAsStringAsync(absolute, base64, { encoding: 'base64' });
          images += 1;
          onProgress?.('images', images, meta?.counts.images ?? 0);
        } catch (e) {
          reportError('backup', e);
        }
        break;
      }
    }
  }

  if (!meta) throw new Error('That file is not a catalogue backup.');
  if (!tables.products.length && !tables.companies.length) {
    throw new Error('That backup is empty — nothing was restored.');
  }

  onProgress?.('database', 1, 1);
  await replaceAllRows(tables);

  return {
    companies: tables.companies.length,
    formulas: tables.formulas.length,
    products: tables.products.length,
    images,
    settings,
  };
}
