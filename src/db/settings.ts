import {
  DEFAULT_EXPORT_SETTINGS,
  EMPTY_BRAND_CONTACT,
  LAYOUTS,
  type BrandContact,
  type ExportSettings,
} from '@/types/models';

import { getDatabase } from './client';

const EXPORT_SETTINGS_KEY = 'export_settings';
const BRAND_CONTACT_KEY = 'brand_contact';

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
    includeContactBox: value.includeContactBox ?? DEFAULT_EXPORT_SETTINGS.includeContactBox,
    framedOnly: value.framedOnly ?? DEFAULT_EXPORT_SETTINGS.framedOnly,
  };
}

function coerceContact(raw: unknown): BrandContact {
  if (!raw || typeof raw !== 'object') return EMPTY_BRAND_CONTACT;
  const value = raw as Partial<BrandContact> & { phone?: string };
  const ceoPhone = typeof value.ceoPhone === 'string' ? value.ceoPhone : '';
  let officePhone = typeof value.officePhone === 'string' ? value.officePhone : '';
  // Pre-dual-phone installs stored a single `phone` — keep it as the office line.
  const legacyPhone = typeof value.phone === 'string' ? value.phone : '';
  if (!ceoPhone && !officePhone && legacyPhone) {
    officePhone = legacyPhone;
  }
  return {
    name: typeof value.name === 'string' ? value.name : '',
    address: typeof value.address === 'string' ? value.address : '',
    mapsUrl: typeof value.mapsUrl === 'string' ? value.mapsUrl : '',
    ceoPhone,
    officePhone,
  };
}

export async function loadBrandContact(): Promise<BrandContact> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`,
      BRAND_CONTACT_KEY
    );
    if (!row?.value) return EMPTY_BRAND_CONTACT;
    return coerceContact(JSON.parse(row.value));
  } catch {
    return EMPTY_BRAND_CONTACT;
  }
}

export async function saveBrandContact(contact: BrandContact): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [BRAND_CONTACT_KEY, JSON.stringify(contact)]
  );
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
