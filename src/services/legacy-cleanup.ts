import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

/**
 * This app used to store free-form photo catalogs; products replaced them.
 * Devices that ran the old version still hold its database and per-catalog
 * image folders, which nothing reads any more. Clear them out once so they
 * stop occupying storage.
 *
 * Every step is best-effort: leftover files are far less bad than an app that
 * refuses to start.
 */
const LEGACY_DATABASE = 'photo_catalogs.db';
const IMAGES_ROOT = 'images';
const CURRENT_IMAGE_FOLDER = 'products';

export async function cleanupLegacyStorage(): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(LEGACY_DATABASE);
  } catch {
    // Not present — nothing to do.
  }

  const root = FileSystem.documentDirectory;
  if (!root) return;

  try {
    const imagesDir = `${root.endsWith('/') ? root : `${root}/`}${IMAGES_ROOT}`;
    const info = await FileSystem.getInfoAsync(imagesDir);
    if (!info.exists || !info.isDirectory) return;

    // Old layout was images/<catalogId>/…; the only folder in use now is
    // images/products, so anything else beside it is orphaned.
    const entries = await FileSystem.readDirectoryAsync(imagesDir);
    for (const entry of entries) {
      if (entry === CURRENT_IMAGE_FOLDER) continue;
      try {
        await FileSystem.deleteAsync(`${imagesDir}/${entry}`, { idempotent: true });
      } catch {
        // skip this one
      }
    }
  } catch {
    // Directory unreadable — leave it alone.
  }
}
