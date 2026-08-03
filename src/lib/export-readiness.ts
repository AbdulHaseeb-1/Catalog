/**
 * Pre-export health checks so a catalogue is not full of surprises.
 */

import { effectiveCrop } from '@/lib/crop-geometry';
import {
  assessResolution,
  cropForLayout,
  hasContactDetails,
  rotatedSize,
  type BrandContact,
  type ExportSettings,
  type ProductWithRefs,
} from '@/types/models';

export type ReadinessHref =
  | { kind: 'settings' }
  | { kind: 'product'; productId: string }
  | { kind: 'products' };

export type ReadinessIssue = {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  /** Where to send the user to fix this. */
  href?: ReadinessHref;
};

export type ExportReadiness = {
  issues: ReadinessIssue[];
  missingCrop: number;
  softImages: number;
  missingImages: number;
  framed: number;
  total: number;
  /** First product missing a crop for the active layout (for deep-link). */
  firstMissingCropId: string | null;
  firstSoftId: string | null;
  firstMissingImageId: string | null;
};

export function assessExportReadiness(
  products: ProductWithRefs[],
  settings: ExportSettings,
  contact: BrandContact
): ExportReadiness {
  const layoutId = settings.layoutId;
  const contactBox = settings.includeContactBox && hasContactDetails(contact);
  const page = {
    layoutId,
    pageSize: settings.pageSize,
    contactBox,
  };

  let missingCrop = 0;
  let softImages = 0;
  let missingImages = 0;
  let framed = 0;
  let firstMissingCropId: string | null = null;
  let firstSoftId: string | null = null;
  let firstMissingImageId: string | null = null;

  for (const p of products) {
    if (!p.imageUri) {
      missingImages += 1;
      if (!firstMissingImageId) firstMissingImageId = p.id;
      continue;
    }
    const crop = cropForLayout(p, layoutId);
    if (crop) framed += 1;
    else {
      missingCrop += 1;
      if (!firstMissingCropId) firstMissingCropId = p.id;
    }

    if (p.width && p.height) {
      const px = effectiveCrop(
        crop,
        rotatedSize({ width: p.width, height: p.height }, p.rotation)
      );
      if (px) {
        const res = assessResolution(px, page);
        if (!res.ok) {
          softImages += 1;
          if (!firstSoftId) firstSoftId = p.id;
        }
      }
    }
  }

  const issues: ReadinessIssue[] = [];
  const layoutName = layoutId === '2x3' ? '2 × 3' : '2 × 2';

  if (settings.includeContactBox && !hasContactDetails(contact)) {
    issues.push({
      id: 'contact',
      severity: 'warn',
      message: 'Contact box is on, but name / phones / address are empty in Settings.',
      href: { kind: 'settings' },
    });
  } else if (settings.includeContactBox && hasContactDetails(contact)) {
    if (!contact.ceoPhone.trim() && !contact.officePhone.trim()) {
      issues.push({
        id: 'phones',
        severity: 'info',
        message: 'No CEO or office phone set — WhatsApp links will not appear on the footer.',
        href: { kind: 'settings' },
      });
    }
    if (contact.address.trim() && !contact.mapsUrl?.trim()) {
      issues.push({
        id: 'maps',
        severity: 'info',
        message: 'Address has no Google Maps link — it will print as plain text.',
        href: { kind: 'settings' },
      });
    }
  }

  if (missingCrop > 0) {
    issues.push({
      id: 'crops',
      severity: settings.framedOnly ? 'warn' : 'info',
      message: settings.framedOnly
        ? `${missingCrop} product(s) have no ${layoutName} crop and will be skipped (framed only).`
        : `${missingCrop} product(s) have no ${layoutName} crop — full frame will be used.`,
      href: firstMissingCropId
        ? { kind: 'product', productId: firstMissingCropId }
        : { kind: 'products' },
    });
  }

  if (softImages > 0) {
    issues.push({
      id: 'soft',
      severity: 'warn',
      message: `${softImages} product(s) look soft for print at ${layoutName} (below ~180 DPI).`,
      href: firstSoftId
        ? { kind: 'product', productId: firstSoftId }
        : { kind: 'products' },
    });
  }

  if (missingImages > 0) {
    issues.push({
      id: 'images',
      severity: 'warn',
      message: `${missingImages} product(s) have no image file.`,
      href: firstMissingImageId
        ? { kind: 'product', productId: firstMissingImageId }
        : { kind: 'products' },
    });
  }

  if (settings.includeContactBox && contactBox) {
    issues.push({
      id: 'contact-aspect',
      severity: 'info',
      message:
        'Contact strip is on — cell shape is slightly shorter. Crops should match this setting.',
    });
  }

  return {
    issues,
    missingCrop,
    softImages,
    missingImages,
    framed,
    total: products.length,
    firstMissingCropId,
    firstSoftId,
    firstMissingImageId,
  };
}
