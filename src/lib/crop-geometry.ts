/**
 * Crop maths.
 *
 * A crop is stored as fractions of the source image rather than pixels, so it
 * survives the image being re-encoded or downscaled — the same rect describes
 * the 4000px original and the 1600px copy kept on disk.
 *
 * Nothing here writes pixels. The stored image is always the untouched master;
 * a crop is re-derived for whatever grid cell it has to fill, which is what
 * lets one crop serve every export layout.
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

/** Aspect ratios within this much of each other are treated as equal. */
const ASPECT_EPSILON = 0.005;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isFullFrame(rect: NormalizedRect | null | undefined): boolean {
  if (!rect) return true;
  return rect.x <= 0.001 && rect.y <= 0.001 && rect.w >= 0.999 && rect.h >= 0.999;
}

/** Force a rect inside the 0..1 box, keeping it non-degenerate. */
export function clampNormalized(rect: NormalizedRect): NormalizedRect {
  const w = clamp(rect.w, 0.001, 1);
  const h = clamp(rect.h, 0.001, 1);
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
 * Reshape a crop to `targetAspect` while keeping what the user framed.
 *
 * The short side grows outwards into the surrounding image; if one edge runs
 * out first the rect slides along rather than losing content, and only when
 * the source has nothing left to give does the other side shrink. Growing
 * outwards is only possible because the master image is never overwritten —
 * that is the whole reason one crop can fill a 4-per-row cell and a
 * full-width cell without being redone.
 */
export function adaptRectToAspect(
  rect: PixelRect,
  targetAspect: number,
  bounds: Size
): PixelRect {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return rect;

  const current = aspectOf(rect);
  if (Math.abs(current - targetAspect) < ASPECT_EPSILON) return rect;

  let width: number;
  let height: number;

  if (current > targetAspect) {
    // Too wide for the cell — take more height from around it.
    width = rect.width;
    height = rect.width / targetAspect;
  } else {
    width = rect.height * targetAspect;
    height = rect.height;
  }

  // The source is the hard limit; past it the other side has to give way.
  if (width > bounds.width) {
    width = bounds.width;
    height = width / targetAspect;
  }
  if (height > bounds.height) {
    height = bounds.height;
    width = height * targetAspect;
  }

  // Keep the user's centre of interest, then slide back inside the source.
  const centreX = rect.originX + rect.width / 2;
  const centreY = rect.originY + rect.height / 2;

  return {
    originX: Math.round(clamp(centreX - width / 2, 0, Math.max(0, bounds.width - width))),
    originY: Math.round(clamp(centreY - height / 2, 0, Math.max(0, bounds.height - height))),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/** Largest centred rect of `targetAspect` that fits the source. */
export function centreRectForAspect(source: Size, targetAspect: number): PixelRect {
  return adaptRectToAspect(
    { originX: 0, originY: 0, width: source.width, height: source.height },
    targetAspect,
    source
  );
}

/**
 * The crop actually used when this product is rendered into a cell of
 * `targetAspect`. Returns null when the source size is unknown, in which case
 * the caller should fall back to a plain centre-cover.
 */
export function effectiveCrop(
  crop: NormalizedRect | null | undefined,
  source: Size | null | undefined,
  targetAspect: number
): PixelRect | null {
  if (!source?.width || !source?.height) return null;
  const base = toPixels(crop ?? FULL_FRAME, source);
  return adaptRectToAspect(base, targetAspect, source);
}

function intersect(a: PixelRect, b: PixelRect): PixelRect | null {
  const left = Math.max(a.originX, b.originX);
  const top = Math.max(a.originY, b.originY);
  const right = Math.min(a.originX + a.width, b.originX + b.width);
  const bottom = Math.min(a.originY + a.height, b.originY + b.height);
  if (right <= left || bottom <= top) return null;
  return { originX: left, originY: top, width: right - left, height: bottom - top };
}

/**
 * The part of a crop that survives every one of `aspects`. Anything outside it
 * is dropped by at least one export layout, which is what the editor's dashed
 * marker warns about.
 */
export function safeRectAcrossAspects(
  rect: PixelRect,
  aspects: number[],
  bounds: Size
): PixelRect | null {
  let safe: PixelRect | null = rect;
  for (const aspect of aspects) {
    if (!safe) return null;
    safe = intersect(safe, adaptRectToAspect(rect, aspect, bounds));
  }
  return safe;
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

/** How much of a crop a given cell aspect keeps, 0..1. */
export function coverageForAspect(
  rect: PixelRect,
  targetAspect: number,
  bounds: Size
): number {
  const adapted = adaptRectToAspect(rect, targetAspect, bounds);
  const kept = intersect(rect, adapted);
  if (!kept) return 0;
  const area = rect.width * rect.height;
  if (area <= 0) return 0;
  return clamp((kept.width * kept.height) / area, 0, 1);
}
