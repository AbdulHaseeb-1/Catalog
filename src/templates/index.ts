import {
  EAGLE_PHARMA_BRAND_NAME,
  EAGLE_PHARMA_LOGO_DATA_URI,
} from '@/constants/brand-logo';
import { escapeHtml, formatLongDate } from '@/lib/format';
import {
  PDF_CONTACT_BOX_HEIGHT,
  hasContactDetails,
  layoutMeta,
  type BrandContact,
  type CatalogSection,
  type Product,
} from '@/types/models';

import type { PdfRenderContext } from './types';

export type { PdfRenderContext };

/* -------------------------------------------------------------------------- */
/* Print palette — clinical, high contrast, safe on any printer                */
/* -------------------------------------------------------------------------- */

const INK = '#101820';
const MUTED = '#5A6570';
const ACCENT = '#1A73E8';
const RULE = '#DDE1E6';
const CELL_LINE = '#E2E0DA';
/** Subtle separator between images, in px. */
const CELL_GAP = 2;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Side margin on text pages (cover, contents, section labels). */
const MARGIN_X = 56;
const MARGIN_Y = 52;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Split `total` into `parts` integers summing exactly to `total`, so a grid
 * fills the page with no thin white strip on the last row/column.
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

function chunk<T>(items: T[], size: number): T[][] {
  if (!items.length || size <= 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Data URIs are already escaped; strip quotes so they cannot break out. */
function safeSrc(src: string | null): string {
  return src ? src.replace(/"/g, '') : '';
}

/**
 * Page shell. Print engines honour fixed-size block + page-break-after far
 * more reliably than CSS paged-media boxes.
 */
function page(width: number, height: number, inner: string, background = '#FFFFFF'): string {
  return `
  <div class="page" style="width:${width}px;height:${height}px;margin:0;padding:0;page-break-after:always;page-break-inside:avoid;overflow:hidden;background:${background};">
    ${inner}
  </div>`;
}

/**
 * Vertically banded text page: header pinned top, body centred, footer pinned
 * bottom. Uses a table because that is what WebView print reliably centres.
 */
function textPage(
  width: number,
  height: number,
  parts: { header?: string; body: string; footer?: string; align?: 'middle' | 'top' }
): string {
  const inner = `
    <table width="${width}" height="${height}" cellspacing="0" cellpadding="0" border="0"
      style="width:${width}px;height:${height}px;border-collapse:collapse;table-layout:fixed;font-family:${FONT_STACK};color:${INK};">
      <tr>
        <td height="80" style="height:80px;vertical-align:top;padding:${MARGIN_Y}px ${MARGIN_X}px 0;">
          ${parts.header ?? ''}
        </td>
      </tr>
      <tr>
        <td style="vertical-align:${parts.align ?? 'middle'};padding:${
          parts.align === 'top' ? `${Math.round(MARGIN_Y * 0.7)}px` : '0'
        } ${MARGIN_X}px 0;">
          ${parts.body}
        </td>
      </tr>
      <tr>
        <td height="70" style="height:70px;vertical-align:bottom;padding:0 ${MARGIN_X}px ${MARGIN_Y}px;">
          ${parts.footer ?? ''}
        </td>
      </tr>
    </table>`;
  return page(width, height, inner);
}

/** Brand line + optional right-hand caption, separated by a hairline. */
function pageHeader(right?: string): string {
  return `
    <table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${ACCENT};">
          ${escapeHtml(EAGLE_PHARMA_BRAND_NAME)}
        </td>
        <td align="right" style="text-align:right;font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">
          ${right ? escapeHtml(right) : ''}
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top:10px;">
          <div style="height:1px;background:${RULE};line-height:0;font-size:0;"></div>
        </td>
      </tr>
    </table>`;
}

function pageFooter(left: string, right: string): string {
  return `
    <table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td colspan="2" style="padding-bottom:10px;">
          <div style="height:1px;background:${RULE};line-height:0;font-size:0;"></div>
        </td>
      </tr>
      <tr>
        <td style="font-size:9.5px;letter-spacing:0.6px;color:${MUTED};">${escapeHtml(left)}</td>
        <td align="right" style="text-align:right;font-size:9.5px;letter-spacing:0.6px;color:${MUTED};">
          ${escapeHtml(right)}
        </td>
      </tr>
    </table>`;
}

/* -------------------------------------------------------------------------- */
/* Cover                                                                       */
/* -------------------------------------------------------------------------- */

function renderCoverPage(ctx: PdfRenderContext): string {
  const { document: doc, pageWidth, pageHeight } = ctx;
  const logoWidth = Math.min(Math.floor(pageWidth * 0.38), 200);

  const body = `
    <div style="text-align:center;">
      <img src="${safeSrc(EAGLE_PHARMA_LOGO_DATA_URI)}" alt="${escapeHtml(EAGLE_PHARMA_BRAND_NAME)}"
        width="${logoWidth}"
        style="display:inline-block;width:${logoWidth}px;max-width:55%;height:auto;border:0;margin:0 auto 34px;" />

      <div style="font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:${MUTED};margin-bottom:14px;">
        Product Catalogue
      </div>

      <div style="font-size:34px;line-height:42px;font-weight:700;letter-spacing:-0.6px;color:${INK};max-width:${pageWidth - MARGIN_X * 2}px;margin:0 auto;">
        ${escapeHtml(doc.title)}
      </div>

      <div style="width:52px;height:3px;background:${ACCENT};margin:22px auto;line-height:0;font-size:0;"></div>

      <div style="font-size:13.5px;line-height:21px;color:${MUTED};max-width:400px;margin:0 auto;">
        ${escapeHtml(doc.subtitle)}
      </div>
    </div>`;

  return textPage(pageWidth, pageHeight, {
    body,
    footer: pageFooter(
      `Generated ${formatLongDate(doc.generatedAt)}`,
      `${doc.productCount} ${doc.productCount === 1 ? 'product' : 'products'}`
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* Contents                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rendered height of one contents row (measured ≈54px), rounded up so the
 * pagination always errs towards a page break rather than a clipped row.
 */
const CONTENTS_ROW_HEIGHT = 58;
/** Height taken by the "Contents" title block on the first contents page. */
const CONTENTS_INTRO_HEIGHT = 96;

function contentsRow(section: CatalogSection, index: number): string {
  return `
      <tr>
        <td width="42" style="width:42px;padding:11px 0;vertical-align:top;font-size:11px;font-weight:700;color:${ACCENT};letter-spacing:0.6px;">
          ${pad2(index + 1)}
        </td>
        <td style="padding:11px 0;vertical-align:top;font-size:14.5px;font-weight:600;color:${INK};">
          ${escapeHtml(section.title)}
          <div style="font-size:11px;font-weight:400;color:${MUTED};margin-top:3px;">
            ${escapeHtml(section.summary)}
          </div>
        </td>
        <td align="right" width="70" style="width:70px;padding:11px 0;vertical-align:top;text-align:right;font-size:12px;font-weight:600;color:${MUTED};">
          ${section.products.length}
        </td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0;">
          <div style="height:1px;background:${RULE};line-height:0;font-size:0;"></div>
        </td>
      </tr>`;
}

/**
 * The index. A catalog of every formula can run to dozens of sections, so the
 * rows are split across as many pages as they need — a page clips its overflow,
 * and a silently truncated contents list would be worse than none.
 */
function renderContentsPages(ctx: PdfRenderContext): string[] {
  const { document: doc, pageWidth, pageHeight } = ctx;

  // Space left for rows once the header band, footer band and margins are gone.
  const usable = pageHeight - MARGIN_Y * 2 - 150;
  const firstPageRows = Math.max(
    4,
    Math.floor((usable - CONTENTS_INTRO_HEIGHT) / CONTENTS_ROW_HEIGHT)
  );
  const laterPageRows = Math.max(4, Math.floor(usable / CONTENTS_ROW_HEIGHT));

  const pages: string[] = [];
  let index = 0;

  while (index < doc.sections.length) {
    const isFirst = pages.length === 0;
    const take = isFirst ? firstPageRows : laterPageRows;
    const slice = doc.sections.slice(index, index + take);

    const intro = isFirst
      ? `
      <div style="font-size:26px;font-weight:700;letter-spacing:-0.4px;color:${INK};margin-bottom:6px;">Contents</div>
      <div style="font-size:12.5px;color:${MUTED};margin-bottom:22px;">${escapeHtml(doc.subtitle)}</div>`
      : '';

    const body = `
      ${intro}
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td colspan="3" style="padding:0 0 4px;">
            <div style="height:1px;background:${RULE};line-height:0;font-size:0;"></div>
          </td>
        </tr>
        ${slice.map((section, i) => contentsRow(section, index + i)).join('')}
      </table>`;

    pages.push(
      textPage(pageWidth, pageHeight, {
        header: pageHeader('Contents'),
        body,
        align: 'top',
        footer: pageFooter(
          formatLongDate(doc.generatedAt),
          `${doc.sections.length} sections`
        ),
      })
    );

    index += take;
  }

  return pages;
}

/* -------------------------------------------------------------------------- */
/* Section label — the starting label for each run of products                 */
/* -------------------------------------------------------------------------- */

/** Cap the member list so a long one cannot overflow the label page. */
const MAX_MEMBERS = 18;

function renderMembers(section: CatalogSection): string {
  if (!section.members.length) return '';

  const shown = section.members.slice(0, MAX_MEMBERS);
  const rest = section.members.length - shown.length;

  // Two balanced columns, filled top-to-bottom.
  const half = Math.ceil(shown.length / 2);
  const columns = [shown.slice(0, half), shown.slice(half)];

  const column = (items: string[]) =>
    items
      .map(
        (name) => `
        <div style="font-size:12px;line-height:19px;color:${INK};padding:2px 0;">
          <span style="color:${ACCENT};font-weight:700;">·</span>&nbsp;${escapeHtml(name)}
        </div>`
      )
      .join('');

  return `
    <div style="margin-top:30px;">
      <div style="font-size:9.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">
        ${escapeHtml(section.membersLabel)}
      </div>
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td width="50%" style="width:50%;vertical-align:top;padding-right:16px;">${column(columns[0])}</td>
          <td width="50%" style="width:50%;vertical-align:top;">${column(columns[1])}</td>
        </tr>
      </table>
      ${
        rest > 0
          ? `<div style="font-size:11px;color:${MUTED};margin-top:10px;">and ${rest} more</div>`
          : ''
      }
    </div>`;
}

function renderSectionLabelPage(
  ctx: PdfRenderContext,
  section: CatalogSection,
  index: number,
  total: number
): string {
  const { document: doc, pageWidth, pageHeight } = ctx;
  const kicker =
    total > 1
      ? `${section.kicker} ${pad2(index + 1)} of ${pad2(total)}`
      : section.kicker;

  const body = `
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${ACCENT};margin-bottom:14px;">
        ${escapeHtml(kicker)}
      </div>
      <div style="font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.5px;color:${INK};">
        ${escapeHtml(section.title)}
      </div>
      <div style="width:44px;height:3px;background:${ACCENT};margin:18px 0;line-height:0;font-size:0;"></div>
      <div style="font-size:13px;line-height:20px;color:${MUTED};">
        ${escapeHtml(section.summary)}
      </div>
      ${
        section.contactLines.length
          ? `<div style="margin-top:12px;">${section.contactLines
              .map(
                (line) =>
                  `<div style="font-size:11.5px;line-height:17px;color:${INK};">${escapeHtml(
                    line
                  )}</div>`
              )
              .join('')}</div>`
          : ''
      }
      ${renderMembers(section)}
    </div>`;

  return textPage(pageWidth, pageHeight, {
    header: pageHeader(doc.title),
    body,
    footer: pageFooter(
      `Generated ${formatLongDate(doc.generatedAt)}`,
      `Section ${pad2(index + 1)} / ${pad2(total)}`
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* Image grid                                                                  */
/* -------------------------------------------------------------------------- */

function imgCell(
  src: string | null,
  w: number,
  h: number,
  borders: { right: boolean; bottom: boolean }
): string {
  const resolved = safeSrc(src);
  const img = resolved
    ? `<img src="${resolved}" width="${w}" height="${h}" style="display:block;width:100%;height:100%;object-fit:cover;object-position:center center;margin:0;padding:0;border:0;outline:0;" />`
    : '';
  const borderCss = [
    borders.right ? `border-right:${CELL_GAP}px solid ${CELL_LINE}` : 'border-right:0',
    borders.bottom ? `border-bottom:${CELL_GAP}px solid ${CELL_LINE}` : 'border-bottom:0',
  ].join(';');

  return `<td width="${w}" height="${h}" style="width:${w}px;height:${h}px;max-width:${w}px;max-height:${h}px;margin:0;padding:0;${borderCss};line-height:0;font-size:0;vertical-align:top;overflow:hidden;background:#111;box-sizing:border-box;">${img}</td>`;
}

function emptyCell(w: number, h: number, borders: { right: boolean; bottom: boolean }): string {
  const borderCss = [
    borders.right ? `border-right:${CELL_GAP}px solid ${CELL_LINE}` : 'border-right:0',
    borders.bottom ? `border-bottom:${CELL_GAP}px solid ${CELL_LINE}` : 'border-bottom:0',
  ].join(';');
  return `<td width="${w}" height="${h}" style="width:${w}px;height:${h}px;margin:0;padding:0;${borderCss};background:#fff;box-sizing:border-box;"></td>`;
}

/**
 * Height of the contact strip at the foot of an image page. Shared with the
 * crop editor, which has to know the true cell height to frame against.
 */
const CONTACT_BOX_HEIGHT = PDF_CONTACT_BOX_HEIGHT;

/**
 * Your details, at the foot of every image page — the page is otherwise a
 * wall of pack shots with nothing saying who to call about them.
 */
function renderContactBox(contact: BrandContact, pageWidth: number): string {
  const name = contact.name.trim();
  const address = contact.address.trim().replace(/\s*\n\s*/g, ' · ');
  const phone = contact.phone.trim();

  const right = [
    address
      ? `<div style="font-size:9px;line-height:13px;color:${MUTED};">${escapeHtml(address)}</div>`
      : '',
    phone
      ? `<div style="font-size:10px;line-height:14px;font-weight:700;color:${INK};letter-spacing:0.2px;">${escapeHtml(
          phone
        )}</div>`
      : '',
  ].join('');

  return `
    <table width="${pageWidth}" height="${CONTACT_BOX_HEIGHT}" cellspacing="0" cellpadding="0" border="0"
      style="width:${pageWidth}px;height:${CONTACT_BOX_HEIGHT}px;border-collapse:collapse;table-layout:fixed;
             background:#FFFFFF;border-top:1px solid ${RULE};font-family:${FONT_STACK};">
      <tr>
        <td style="vertical-align:middle;padding:0 ${MARGIN_X / 2}px;">
          <div style="font-size:12px;line-height:16px;font-weight:700;color:${INK};letter-spacing:-0.1px;">
            ${escapeHtml(name)}
          </div>
        </td>
        <td align="right" style="text-align:right;vertical-align:middle;padding:0 ${MARGIN_X / 2}px;">
          ${right}
        </td>
      </tr>
    </table>`;
}

/**
 * Full-bleed grid of pack shots. Each image arrives already rendered to this
 * layout's cell aspect, so the `object-fit: cover` in `imgCell` is only a
 * safety net for products whose source size was never recorded.
 */
function renderGridPage(
  ctx: PdfRenderContext,
  group: Product[],
  columns: number,
  rows: number
): string {
  const { pageWidth, pageHeight, resolveImage, settings, contact } = ctx;

  // The strip eats into the grid rather than overlapping it, so no pack shot
  // is ever partly hidden behind the contact details.
  const showContact = settings.includeContactBox && hasContactDetails(contact);
  const gridHeight = showContact ? pageHeight - CONTACT_BOX_HEIGHT : pageHeight;

  const colWidths = distribute(pageWidth, columns);
  const rowHeights = distribute(gridHeight, rows);
  const rowHtml: string[] = [];
  let index = 0;

  for (let r = 0; r < rows; r++) {
    const h = rowHeights[r];
    const cells: string[] = [];
    for (let c = 0; c < columns; c++) {
      const w = colWidths[c];
      const borders = { right: c < columns - 1, bottom: r < rows - 1 };
      const product = group[index];
      if (product) {
        index += 1;
        cells.push(imgCell(resolveImage(product), w, h, borders));
      } else {
        cells.push(emptyCell(w, h, borders));
      }
    }
    rowHtml.push(`<tr style="margin:0;padding:0;height:${h}px;">${cells.join('')}</tr>`);
  }

  const inner = `
    <table width="${pageWidth}" height="${gridHeight}" cellspacing="0" cellpadding="0" border="0"
      style="width:${pageWidth}px;height:${gridHeight}px;border-collapse:collapse;border-spacing:0;margin:0;padding:0;table-layout:fixed;">
      ${rowHtml.join('')}
    </table>
    ${showContact ? renderContactBox(contact, pageWidth) : ''}`;

  return page(pageWidth, pageHeight, inner);
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Assemble the catalog:
 *   cover → contents (multi-section) → [section label → image pages] × n
 */
export function renderCatalogHtml(ctx: PdfRenderContext): string {
  const { document: doc, settings, pageWidth, pageHeight } = ctx;
  const meta = layoutMeta(settings.layoutId);
  const columns = Math.max(1, meta.columns);
  const rows = Math.max(1, meta.rows);
  const perPage = columns * rows;

  const pages: string[] = [];

  if (settings.includeCover) {
    pages.push(renderCoverPage(ctx));
  }
  if (settings.includeContents && doc.sections.length > 1) {
    pages.push(...renderContentsPages(ctx));
  }

  doc.sections.forEach((section, i) => {
    if (settings.includeSectionLabels) {
      pages.push(renderSectionLabelPage(ctx, section, i, doc.sections.length));
    }
    for (const group of chunk(section.products, perPage)) {
      pages.push(renderGridPage(ctx, group, columns, rows));
    }
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${pageWidth}, initial-scale=1" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    @page { margin: 0 !important; size: ${pageWidth}px ${pageHeight}px; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${pageWidth}px !important;
      background: #fff;
      font-family: ${FONT_STACK};
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .page:last-child { page-break-after: auto !important; }
    table { border-collapse: collapse !important; border-spacing: 0 !important; }
    img {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  </style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}
