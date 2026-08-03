import {
  LAYOUTS,
  cellAspectRatio,
  layoutMeta,
  type LayoutId,
  type PageSize,
} from '@/types/models';

export type CropAspectGroup = 'layout' | 'standard' | 'source';

export type CropAspectPreset = {
  id: string;
  label: string;
  /** Short hint under the chip. */
  hint: string;
  /** width / height */
  ratio: number;
  group: CropAspectGroup;
};

export type PageContext = {
  layoutId: LayoutId | string;
  pageSize: PageSize;
  /** Whether the export prints the contact strip — it shortens every cell. */
  contactBox?: boolean;
};

/** Aspect (W/H) of one grid cell for a layout on the given paper. */
export function cellAspectFor(ctx: PageContext): number {
  return cellAspectRatio(ctx);
}

/** Every layout's cell aspect, used for the safe-area and grid previews. */
export function layoutCellAspects(ctx: Omit<PageContext, 'layoutId'>): {
  id: LayoutId;
  name: string;
  aspect: number;
}[] {
  return LAYOUTS.map((layout) => ({
    id: layout.id,
    name: layout.name,
    aspect: cellAspectRatio({ ...ctx, layoutId: layout.id }),
  }));
}

const STANDARD: CropAspectPreset[] = [
  { id: '1:1', label: '1:1', hint: 'Square', ratio: 1, group: 'standard' },
  { id: '4:5', label: '4:5', hint: 'Tall product shot', ratio: 4 / 5, group: 'standard' },
  { id: '3:4', label: '3:4', hint: 'Classic portrait', ratio: 3 / 4, group: 'standard' },
  { id: '2:3', label: '2:3', hint: 'Portrait', ratio: 2 / 3, group: 'standard' },
  { id: '5:7', label: '5:7', hint: 'Print portrait', ratio: 5 / 7, group: 'standard' },
  { id: '3:2', label: '3:2', hint: 'Landscape', ratio: 3 / 2, group: 'standard' },
  { id: '16:9', label: '16:9', hint: 'Wide landscape', ratio: 16 / 9, group: 'standard' },
];

/**
 * Crop templates. The first is the cell of the layout the user is exporting
 * with; the rest of the layouts follow, so a shot can be framed for a grid
 * other than the one currently selected. A crop is reshaped to whatever cell
 * it lands in, so none of these locks the image to one layout.
 */
export function cropAspectPresets(ctx: PageContext): CropAspectPreset[] {
  const active = layoutMeta(ctx.layoutId);

  const layoutPresets: CropAspectPreset[] = LAYOUTS.map((layout) => ({
    id: `layout:${layout.id}`,
    label: `${layout.columns}×${layout.rows} cell`,
    hint:
      layout.id === active.id
        ? 'Exact fit · your export layout'
        : `Fits ${layout.name.toLowerCase()}`,
    ratio: cellAspectRatio({ ...ctx, layoutId: layout.id }),
    group: 'layout',
  }));

  // The selected layout first — it is the one crop that needs no reshaping.
  layoutPresets.sort((a, b) => {
    const aActive = a.id === `layout:${active.id}` ? 0 : 1;
    const bActive = b.id === `layout:${active.id}` ? 0 : 1;
    return aActive - bActive;
  });

  return [...layoutPresets, ...STANDARD];
}

/** Preset whose ratio is closest to `aspect` — used to reopen an old crop. */
export function nearestPreset(
  presets: CropAspectPreset[],
  aspect: number
): CropAspectPreset {
  let best = presets[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const preset of presets) {
    const delta = Math.abs(Math.log(preset.ratio / aspect));
    if (delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best;
}
