import { layoutMeta, pageDimensionsForCatalog, type LayoutId, type PageSize } from '@/types/models';

export type CropAspectId =
  | 'layout-cell'
  | '1:1'
  | '4:5'
  | '3:4'
  | '2:3'
  | '5:7'
  | '16:9';

export type CropAspectPreset = {
  id: CropAspectId;
  label: string;
  /** Short hint under the chip */
  hint: string;
  /** width / height (null = free, not used) */
  ratio: number;
};

/** Cell aspect (W/H) for a layout on the catalog page size. */
export function cellAspectRatio(
  layoutId: LayoutId | string,
  pageSize: PageSize = 'A4'
): number {
  const meta = layoutMeta(layoutId);
  const page = pageDimensionsForCatalog({ layoutId, pageSize });
  const cellW = page.width / meta.columns;
  const cellH = page.height / meta.rows;
  return cellW / cellH;
}

/**
 * Presets tuned for fitting photos into grid cells (especially 2×2 on A4).
 * First option is always the exact layout cell ratio.
 */
export function cropAspectPresets(
  layoutId: LayoutId | string,
  pageSize: PageSize = 'A4'
): CropAspectPreset[] {
  const cell = cellAspectRatio(layoutId, pageSize);
  const meta = layoutMeta(layoutId);

  return [
    {
      id: 'layout-cell',
      label: `${meta.columns}×${meta.rows} cell`,
      hint: 'Best fit for this layout',
      ratio: cell,
    },
    {
      id: '2:3',
      label: '2:3',
      hint: 'Portrait · close to A4 cell',
      ratio: 2 / 3,
    },
    {
      id: '3:4',
      label: '3:4',
      hint: 'Classic portrait',
      ratio: 3 / 4,
    },
    {
      id: '4:5',
      label: '4:5',
      hint: 'Social / product',
      ratio: 4 / 5,
    },
    {
      id: '1:1',
      label: '1:1',
      hint: 'Square',
      ratio: 1,
    },
    {
      id: '5:7',
      label: '5:7',
      hint: 'Print portrait',
      ratio: 5 / 7,
    },
    {
      id: '16:9',
      label: '16:9',
      hint: 'Wide landscape',
      ratio: 16 / 9,
    },
  ];
}

/**
 * Largest centered crop rectangle of the given aspect (width/height)
 * that fits inside imageW × imageH.
 */
export function centerCropRect(
  imageW: number,
  imageH: number,
  aspect: number // width / height
): { originX: number; originY: number; width: number; height: number } {
  if (imageW <= 0 || imageH <= 0 || aspect <= 0) {
    return { originX: 0, originY: 0, width: Math.max(1, imageW), height: Math.max(1, imageH) };
  }

  const imageAspect = imageW / imageH;

  let width: number;
  let height: number;

  if (imageAspect > aspect) {
    // Image is wider than target — crop sides
    height = imageH;
    width = Math.round(height * aspect);
  } else {
    // Image is taller — crop top/bottom
    width = imageW;
    height = Math.round(width / aspect);
  }

  width = Math.min(width, imageW);
  height = Math.min(height, imageH);

  const originX = Math.max(0, Math.floor((imageW - width) / 2));
  const originY = Math.max(0, Math.floor((imageH - height) / 2));

  return {
    originX,
    originY,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

/**
 * Offset crop: aspect-fixed rect, shifted by normalized offsets in [-1, 1]
 * where 0 is centered.
 */
export function offsetCropRect(
  imageW: number,
  imageH: number,
  aspect: number,
  offsetX: number, // -1 left … 1 right
  offsetY: number // -1 top … 1 bottom
): { originX: number; originY: number; width: number; height: number } {
  const base = centerCropRect(imageW, imageH, aspect);
  const maxOX = Math.max(0, imageW - base.width);
  const maxOY = Math.max(0, imageH - base.height);

  // Map -1..1 to 0..max
  const tX = (Math.max(-1, Math.min(1, offsetX)) + 1) / 2;
  const tY = (Math.max(-1, Math.min(1, offsetY)) + 1) / 2;

  return {
    originX: Math.round(tX * maxOX),
    originY: Math.round(tY * maxOY),
    width: base.width,
    height: base.height,
  };
}
