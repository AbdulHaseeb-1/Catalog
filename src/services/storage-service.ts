import * as repo from '@/db/repository';
import { reportError } from '@/lib/errors';

import {
  deleteFolderContents,
  deleteImageFiles,
  listStoredImageFiles,
  measureExportBytes,
  measureImageBytes,
} from './image-service';

/** How long a deleted product stays recoverable before its file is freed. */
export const BIN_RETENTION_MS = 24 * 60 * 60 * 1000;

export type StorageReport = {
  /** Bytes held by images a live or binned product still points at. */
  imageBytes: number;
  /** Bytes held by files on disk that nothing references. */
  orphanBytes: number;
  orphanCount: number;
  /** Catalogue PDFs saved under Documents/Catalogs (kept). */
  exportBytes: number;
  /** Products sitting in the bin, still restorable. */
  binnedCount: number;
  totalBytes: number;
};

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files on disk that no product row points at.
 *
 * `deleteImageFile` is best effort by design, so a failed delete — or the app
 * being killed between writing a file and committing its row — leaves bytes
 * behind that nothing will ever reclaim on its own.
 */
async function findOrphans(): Promise<string[]> {
  const [onDisk, referenced] = await Promise.all([
    listStoredImageFiles(),
    repo.listReferencedImagePaths(),
  ]);
  const keep = new Set(referenced);
  return onDisk.filter((path) => !keep.has(path));
}

export async function inspectStorage(): Promise<StorageReport> {
  const [referenced, orphans, exports, binnedCount] = await Promise.all([
    repo.listReferencedImagePaths(),
    findOrphans(),
    measureExportBytes(),
    repo.countDeletedProducts(),
  ]);

  const [imageBytes, orphanBytes] = await Promise.all([
    measureImageBytes(referenced),
    measureImageBytes(orphans),
  ]);

  return {
    imageBytes,
    orphanBytes,
    orphanCount: orphans.length,
    exportBytes: exports.bytes,
    binnedCount,
    totalBytes: imageBytes + orphanBytes + exports.bytes,
  };
}

export type SweepResult = { freedBytes: number; orphans: number; purged: number };

/**
 * Reclaim what is safe to reclaim: unreferenced image files, legacy temp PDF
 * cache under exports/, and products binned longer ago than the undo window.
 * Documents/Catalogs is never wiped — those are saved catalogues.
 */
export async function sweepStorage(
  opts: { purgeBin?: boolean } = {}
): Promise<SweepResult> {
  const orphans = await findOrphans();
  const orphanBytes = await measureImageBytes(orphans);
  await deleteImageFiles(orphans);

  const exports = await measureExportBytes();
  let reclaimedPdf = 0;
  if (exports.legacyFolder && exports.legacyBytes > 0) {
    reclaimedPdf = exports.legacyBytes;
    await deleteFolderContents(exports.legacyFolder);
  }

  let purged = 0;
  let purgedBytes = 0;
  try {
    const retention = opts.purgeBin ? 0 : BIN_RETENTION_MS;
    const freed = await repo.purgeDeletedProducts(retention);
    purged = freed.length;
    purgedBytes = await measureImageBytes(freed);
    await deleteImageFiles(freed);
  } catch (e) {
    // Losing the purge still leaves the orphan sweep worth reporting.
    reportError('library', e);
  }

  return {
    freedBytes: orphanBytes + reclaimedPdf + purgedBytes,
    orphans: orphans.length,
    purged,
  };
}

/**
 * Empty the bin of anything past the undo window. Runs once after startup so
 * soft-deleted products cannot accumulate forever.
 */
export async function purgeExpiredBin(): Promise<void> {
  try {
    const freed = await repo.purgeDeletedProducts(BIN_RETENTION_MS);
    if (freed.length) await deleteImageFiles(freed);
  } catch (e) {
    reportError('library', e);
  }
}
