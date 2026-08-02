import { DEFAULT_EXPORT_SETTINGS, LAYOUTS, type ExportSettings } from '@/types/models';

import { getDatabase } from './client';

const EXPORT_SETTINGS_KEY = 'export_settings';

/** Narrow arbitrary stored JSON back into valid settings. */
function coerceSettings(raw: unknown): ExportSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_EXPORT_SETTINGS;
  const value = raw as Partial<ExportSettings>;
  const layoutId = LAYOUTS.some((l) => l.id === value.layoutId)
    ? (value.layoutId as ExportSettings['layoutId'])
    : DEFAULT_EXPORT_SETTINGS.layoutId;

  return {
    layoutId,
    pageSize: value.pageSize === 'Letter' ? 'Letter' : 'A4',
    includeCover: value.includeCover ?? DEFAULT_EXPORT_SETTINGS.includeCover,
    includeContents: value.includeContents ?? DEFAULT_EXPORT_SETTINGS.includeContents,
    includeSectionLabels:
      value.includeSectionLabels ?? DEFAULT_EXPORT_SETTINGS.includeSectionLabels,
  };
}

export async function loadExportSettings(): Promise<ExportSettings> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`,
      EXPORT_SETTINGS_KEY
    );
    if (!row?.value) return DEFAULT_EXPORT_SETTINGS;
    return coerceSettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

export async function saveExportSettings(settings: ExportSettings): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [EXPORT_SETTINGS_KEY, JSON.stringify(settings)]
  );
}

/** One-shot markers for work that must happen once per install. */
export async function isFlagSet(key: string): Promise<boolean> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`,
      key
    );
    return row?.value === '1';
  } catch {
    return false;
  }
}

export async function setFlag(key: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, '1')
     ON CONFLICT(key) DO UPDATE SET value = '1'`,
    key
  );
}
