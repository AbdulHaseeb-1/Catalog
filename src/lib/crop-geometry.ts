/**
 * Crop maths.
 *
 * A crop is stored as fractions of the source image rather than pixels, so it
 * survives the image being re-encoded or downscaled — the same rect describes
 * the 4000px original and the 1600px copy kept on disk.
 *
 * Nothing here writes pixels. The stored image is always the untouched master;
 * each layout keeps its own rect (cell-aspect locked in the crop editor), and
 * the exporter cover-fills that rect into the matching grid cell.
 */

/** Rect in 0..1 fractions of the source image. */
export type NormalizedRect = { x: number; y: number; w: number; h: number };

/** Rect in source pixels — what the image manipulator wants. */
export type PixelRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type Size = { width: number; height: number };

export const FULL_FRAME: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest crop worth keeping, as a fraction of the source. */
const MIN_SIDE = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isFullFrame(rect: NormalizedRect | null | undefined): boolean {
  if (!rect) return true;
  return rect.x <= 0.001 && rect.y <= 0.001 && rect.w >= 0.999 && rect.h >= 0.999;
}

/** Force a rect inside the 0..1 box, keeping it non-degenerate. */
export function clampNormalized(rect: NormalizedRect): NormalizedRect {
  const w = clamp(rect.w, MIN_SIDE, 1);
  const h = clamp(rect.h, MIN_SIDE, 1);
  return {
    x: clamp(rect.x, 0, 1 - w),
    y: clamp(rect.y, 0, 1 - h),
    w,
    h,
  };
}

export function toPixels(rect: NormalizedRect, source: Size): PixelRect {
  const safe = clampNormalized(rect);
  return {
    originX: Math.round(safe.x * source.width),
    originY: Math.round(safe.y * source.height),
    width: Math.max(1, Math.round(safe.w * source.width)),
    height: Math.max(1, Math.round(safe.h * source.height)),
  };
}

export function toNormalized(rect: PixelRect, source: Size): NormalizedRect {
  if (!source.width || !source.height) return FULL_FRAME;
  return clampNormalized({
    x: rect.originX / source.width,
    y: rect.originY / source.height,
    w: rect.width / source.width,
    h: rect.height / source.height,
  });
}

export function aspectOf(rect: PixelRect): number {
  return rect.width / Math.max(1, rect.height);
}

/**
 * The pixels to render for a product: the crop, or the whole frame when none
 * was set. The crop should already match the cell aspect for the layout being
 * exported; the PDF then cover-fills that rect into the cell.
 */
export function effectiveCrop(
  crop: NormalizedRect | null | undefined,
  source: Size | null | undefined
): PixelRect | null {
  if (!source?.width || !source?.height) return null;
  return toPixels(crop ?? FULL_FRAME, source);
}

/**
 * Propose a cover-style crop of `targetAspect` (W/H) from an intent rect
 * (e.g. a finished 2×2 crop when opening the 2×3 editor). Centres on the
 * intent, sizes so the intent is covered, and clamps to the image.
 */
export function deriveCoverCrop(
  intent: NormalizedRect | null | undefined,
  source: Size,
  targetAspect: number
): NormalizedRect {
  if (!source.width || !source.height || !Number.isFinite(targetAspect) || targetAspect <= 0) {
    return FULL_FRAME;
  }

  const base = intent ? clampNormalized(intent) : FULL_FRAME;
  const px = toPixels(base, source);
  const cx = px.originX + px.width / 2;
  const cy = px.originY + px.height / 2;

  // Cover the intent with a window of the target aspect.
  const intentAspect = px.width / Math.max(1, px.height);
  let w: number;
  let h: number;
  if (intentAspect > targetAspect) {
    w = px.width;
    h = w / targetAspect;
  } else {
    h = px.height;
    w = h * targetAspect;
  }

  // Shrink if the window would leave the image.
  if (w > source.width) {
    w = source.width;
    h = w / targetAspect;
  }
  if (h > source.height) {
    h = source.height;
    w = h * targetAspect;
  }
  // Final clamp if aspect + bounds still overflow (extreme targetAspect).
  w = Math.min(w, source.width);
  h = Math.min(h, source.height);

  const originX = clamp(cx - w / 2, 0, source.width - w);
  const originY = clamp(cy - h / 2, 0, source.height - h);

  return toNormalized(
    { originX, originY, width: Math.max(1, w), height: Math.max(1, h) },
    source
  );
}

/**
 * Carry a normalized rect through a clockwise quarter turn.
 *
 * Rotation is applied before the crop when rendering, so turning the image has
 * to turn the stored framing with it — otherwise a 90° turn would leave the
 * frame pointing at a completely different part of the pack.
 */
export function rotateNormalized(
  rect: NormalizedRect,
  quarterTurnsClockwise: number
): NormalizedRect {
  const turns = ((Math.round(quarterTurnsClockwise) % 4) + 4) % 4;
  let out = clampNormalized(rect);
  for (let i = 0; i < turns; i++) {
    // (x, y) → (1 − y − h, x), with the sides swapping.
    out = clampNormalized({
      x: 1 - out.y - out.h,
      y: out.x,
      w: out.h,
      h: out.w,
    });
  }
  return out;
}

/**
 * How a crop sits inside a cell of `cellAspect` once fitted whole. Returns the
 * fraction of the cell the picture covers on each axis — the app previews use
 * this to draw exactly what the PDF will print.
 */
export function fitInCell(
  crop: Size,
  cellAspect: number
): { widthFraction: number; heightFraction: number } {
  const cropAspect = crop.width / Math.max(1, crop.height);
  if (cropAspect > cellAspect) {
    // Wider than the cell — the width binds and white space goes above/below.
    return { widthFraction: 1, heightFraction: clamp(cellAspect / cropAspect, 0, 1) };
  }
  return { widthFraction: clamp(cropAspect / cellAspect, 0, 1), heightFraction: 1 };
}
