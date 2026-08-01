import {
  EAGLE_PHARMA_BRAND_NAME,
  EAGLE_PHARMA_LOGO_DATA_URI,
} from '@/constants/brand-logo';
import { escapeHtml } from '@/lib/format';
import { layoutMeta, type Catalog, type LayoutId, type Photo } from '@/types/models';

import type { PdfRenderContext } from './types';

export type { PdfRenderContext };

/**
 * Split `total` into `parts` integers that sum exactly to `total`.
 * Last part absorbs remainder (no thin white strip).
 */
function distribute(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  if (parts === 1) return [total];
  const base = Math.floor(total / parts);
  const sizes = Array.from({ length: parts }, () => base);
  let rem = total - base * parts;
  for (let i = parts - 1; rem > 0; i--, rem--) {
    sizes[i] += 1;
  }
  return sizes;
}

function chunkPages(photos: Photo[], perPage: number): Photo[][] {
  if (!photos.length) return [];
  const pages: Photo[][] = [];
  for (let i = 0; i < photos.length; i += perPage) {
    pages.push(photos.slice(i, i + perPage));
  }
  return pages;
}

const CELL_GAP = 2; // subtle separator between images (px)
const CELL_LINE = '#E2E0DA';

/**
 * Image cell with auto-cover crop and subtle borders between cells.
 * border flags: show right / bottom separator lines.
 */
function imgCell(
  src: string | null,
  w: number,
  h: number,
  borders: { right: boolean; bottom: boolean }
): string {
  const safeSrc = src ? src.replace(/"/g, '') : '';
  const img = safeSrc
    ? `<img src="${safeSrc}" width="${w}" height="${h}" style="display:block;width:100%;height:100%;object-fit:cover;object-position:center center;margin:0;padding:0;border:0;outline:0;" />`
    : '';
  const borderCss = [
    borders.right ? `border-right:${CELL_GAP}px solid ${CELL_LINE}` : 'border-right:0',
    borders.bottom ? `border-bottom:${CELL_GAP}px solid ${CELL_LINE}` : 'border-bottom:0',
  ].join(';');
  return `<td width="${w}" height="${h}" style="width:${w}px;height:${h}px;max-width:${w}px;max-height:${h}px;margin:0;padding:0;${borderCss};line-height:0;font-size:0;vertical-align:top;overflow:hidden;background:#111;box-sizing:border-box;">${img}</td>`;
}

/** First page: brand logo only, centered. */
function renderCoverPage(pageWidth: number, pageHeight: number): string {
  const logoMax = Math.min(Math.floor(pageWidth * 0.5), 260);
  const safeLogo = EAGLE_PHARMA_LOGO_DATA_URI.replace(/"/g, '');

  return `
  <div class="page" style="width:${pageWidth}px;height:${pageHeight}px;margin:0;padding:0;page-break-after:always;page-break-inside:avoid;overflow:hidden;">
    <table width="${pageWidth}" height="${pageHeight}" cellspacing="0" cellpadding="0" border="0" style="width:${pageWidth}px;height:${pageHeight}px;border-collapse:collapse;margin:0;padding:0;table-layout:fixed;">
      <tr>
        <td width="${pageWidth}" height="${pageHeight}" style="width:${pageWidth}px;height:${pageHeight}px;vertical-align:middle;text-align:center;margin:0;padding:0;">
          <img
            src="${safeLogo}"
            alt="${escapeHtml(EAGLE_PHARMA_BRAND_NAME)}"
            width="${logoMax}"
            style="display:inline-block;margin:0 auto;width:${logoMax}px;max-width:55%;height:auto;border:0;"
          />
        </td>
      </tr>
    </table>
  </div>`;
}

/**
 * Fixed grid page: e.g. 2 columns × 3 rows = 6 images, full-bleed, auto-cropped.
 */
function renderPhotoPage(
  group: Photo[],
  columns: number,
  rows: number,
  pageWidth: number,
  pageHeight: number,
  resolveImage: (uri: string | null) => string | null
): string {
  // Account for subtle internal separators so the table still fills the page
  const gapX = CELL_GAP * (columns - 1);
  const gapY = CELL_GAP * (rows - 1);
  const colWidths = distribute(pageWidth, columns);
  const rowHeights = distribute(pageHeight, rows);
  const rowHtml: string[] = [];
  let photoIndex = 0;

  for (let r = 0; r < rows; r++) {
    const h = rowHeights[r];
    const tds: string[] = [];
    for (let c = 0; c < columns; c++) {
      const w = colWidths[c];
      const borders = {
        right: c < columns - 1,
        bottom: r < rows - 1,
      };
      const photo = group[photoIndex];
      if (photo) {
        photoIndex += 1;
        tds.push(imgCell(resolveImage(photo.uri), w, h, borders));
      } else {
        const borderCss = [
          borders.right ? `border-right:${CELL_GAP}px solid ${CELL_LINE}` : 'border-right:0',
          borders.bottom ? `border-bottom:${CELL_GAP}px solid ${CELL_LINE}` : 'border-bottom:0',
        ].join(';');
        tds.push(
          `<td width="${w}" height="${h}" style="width:${w}px;height:${h}px;margin:0;padding:0;${borderCss};background:#fff;box-sizing:border-box;"></td>`
        );
      }
    }
    rowHtml.push(`<tr style="margin:0;padding:0;height:${h}px;">${tds.join('')}</tr>`);
  }

  // gapX/gapY reserved conceptually via box-sizing borders on cells
  void gapX;
  void gapY;

  return `
  <div class="page" style="width:${pageWidth}px;height:${pageHeight}px;margin:0;padding:0;page-break-after:always;page-break-inside:avoid;overflow:hidden;background:#fff;">
    <table width="${pageWidth}" height="${pageHeight}" cellspacing="0" cellpadding="0" border="0" style="width:${pageWidth}px;height:${pageHeight}px;border-collapse:collapse;border-spacing:0;margin:0;padding:0;table-layout:fixed;">
      ${rowHtml.join('')}
    </table>
  </div>`;
}

/**
 * Photo catalog PDF:
 * - page 1: centered logo
 * - photo pages: fixed columns×rows grid (2-col = 2×3 = 6), auto-crop cover
 */
export function renderCatalogHtml(ctx: PdfRenderContext): string {
  const { catalog, photos, resolveImage, pageWidth = 595, pageHeight = 842 } = ctx;
  const meta = layoutMeta(catalog.layoutId);
  // Always use fixed grid from layout meta (2 per row → 2 cols × 3 rows = 6)
  const columns = Math.max(1, meta.columns);
  const rows = Math.max(1, meta.rows);
  const perPage = columns * rows;
  const photoPages = chunkPages(photos, perPage);

  const cover = renderCoverPage(pageWidth, pageHeight);
  const productPagesHtml = photoPages
    .map((group) =>
      renderPhotoPage(group, columns, rows, pageWidth, pageHeight, resolveImage)
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${pageWidth}, initial-scale=1" />
  <title>${escapeHtml(catalog.title)}</title>
  <style>
    @page { margin: 0 !important; size: ${pageWidth}px ${pageHeight}px; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${pageWidth}px !important;
      background: #fff;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .page:last-child { page-break-after: auto !important; }
    table { border-collapse: collapse !important; border-spacing: 0 !important; }
    td, tr { border: 0 !important; padding: 0 !important; margin: 0 !important; }
    img {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  </style>
</head>
<body>
${cover}
${productPagesHtml}
</body>
</html>`;
}

export function getLayoutColumns(id: LayoutId): number {
  return layoutMeta(id).columns;
}

export type { Catalog };
