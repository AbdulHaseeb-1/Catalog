import { layoutMeta, pageDimensions, type LayoutId, type PageSize } from '@/types/models';

export type CropAspectId = 'layout-cell' | '1:1' | '4:5' | '3:4' | '2:3' | '5:7' | '16:9';

export type CropAspectPreset = {
  id: CropAspectId;
  label: string;
  /** Short hint under the chip. */
  hint: string;
  /** width / height */
  ratio: number;
};

/** Aspect (W/H) of one grid cell for a layout on the given paper. */
export function cellAspectRatio(
  layoutId: LayoutId | string,
  pageSize: PageSize = 'A4'
): number {
  const meta = layoutMeta(layoutId);
  const page = pageDimensions({ layoutId, pageSize });
  return page.width / meta.columns / (page.height / meta.rows);
}

/**
 * Crop presets for fitting a pack shot into a grid cell. The first option is
 * always the exact cell ratio of the layout the user is exporting with.
 */
export function cropAspectPresets(
  layoutId: LayoutId | string,
  pageSize: PageSize = 'A4'
): CropAspectPreset[] {
  const meta = layoutMeta(layoutId);

  return [
    {
      id: 'layout-cell',
      label: `${meta.columns}×${meta.rows} cell`,
      hint: 'Exact fit for your export layout',
      ratio: cellAspectRatio(layoutId, pageSize),
    },
    { id: '2:3', label: '2:3', hint: 'Portrait · close to A4 cell', ratio: 2 / 3 },
    { id: '3:4', label: '3:4', hint: 'Classic portrait', ratio: 3 / 4 },
    { id: '4:5', label: '4:5', hint: 'Tall product shot', ratio: 4 / 5 },
    { id: '1:1', label: '1:1', hint: 'Square', ratio: 1 },
    { id: '5:7', label: '5:7', hint: 'Print portrait', ratio: 5 / 7 },
    { id: '16:9', label: '16:9', hint: 'Wide landscape', ratio: 16 / 9 },
  ];
}
