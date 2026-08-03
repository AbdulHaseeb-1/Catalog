/**
 * Auto-trim: find the pack in a shot taken on a plain background.
 *
 * React Native gives no way to read pixels, so the detector runs where a
 * canvas exists — a hidden WebView on device, the DOM on web. The scanner
 * below is stringified and injected into that canvas, which is why it must
 * stay entirely self-contained: no imports, no closures, no helpers from this
 * module. See `components/auto-trim-probe`.
 *
 * Best effort by design. Every failure path resolves to null and the editor
 * simply carries on without a suggestion.
 */

import type { NormalizedRect } from './crop-geometry';

/** Longest edge the probe scans. Small is plenty for a bounding box. */
export const PROBE_MAX_EDGE = 220;

/**
 * How far a channel may drift from the background before a pixel counts as
 * content. Loose enough to ignore shadows and JPEG noise on white card, tight
 * enough to catch a pale box.
 */
export const DEFAULT_TOLERANCE = 26;

/**
 * Bounding box of the non-background pixels, in 0..1 fractions.
 *
 * SELF-CONTAINED — the source of this function is injected into a WebView.
 * Do not reference anything outside its own body.
 */
export function scanForContent(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
  tolerance: number
): { x: number; y: number; w: number; h: number } | null {
  if (!width || !height) return null;

  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // The background is whatever the four corners agree on. A median across the
  // corners shrugs off one corner that happens to hold a bit of the pack.
  const corners = [
    at(0, 0),
    at(width - 1, 0),
    at(0, height - 1),
    at(width - 1, height - 1),
  ];
  const bg = [0, 1, 2].map((channel) => {
    const values = corners.map((c) => c[channel]).sort((a, b) => a - b);
    return (values[1] + values[2]) / 2;
  });

  const rowHits = new Array(height).fill(0);
  const colHits = new Array(width).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y);
      const diff = Math.max(
        Math.abs(p[0] - bg[0]),
        Math.abs(p[1] - bg[1]),
        Math.abs(p[2] - bg[2])
      );
      if (diff > tolerance) {
        rowHits[y] += 1;
        colHits[x] += 1;
      }
    }
  }

  // Ignore specks: a row or column needs this share of content pixels to
  // count. Inlined because this function's source is injected into a WebView
  // where module constants do not exist.
  const minRow = Math.max(1, Math.floor(width * 0.012));
  const minCol = Math.max(1, Math.floor(height * 0.012));

  let top = 0;
  while (top < height && rowHits[top] < minRow) top++;
  let bottom = height - 1;
  while (bottom > top && rowHits[bottom] < minRow) bottom--;
  let left = 0;
  while (left < width && colHits[left] < minCol) left++;
  let right = width - 1;
  while (right > left && colHits[right] < minCol) right--;

  if (right <= left || bottom <= top) return null;

  // Everything is content — there was no background to trim.
  const coversAll =
    left === 0 && top === 0 && right === width - 1 && bottom === height - 1;
  if (coversAll) return null;

  return {
    x: left / width,
    y: top / height,
    w: (right - left + 1) / width,
    h: (bottom - top + 1) / height,
  };
}

/** Breathing room left around the detected pack, as a share of its size. */
const PADDING = 0.03;

/** Pad the detected box a little and clamp it back inside the frame. */
export function padDetection(rect: {
  x: number;
  y: number;
  w: number;
  h: number;
}): NormalizedRect {
  const padX = rect.w * PADDING;
  const padY = rect.h * PADDING;
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  return {
    x,
    y,
    w: Math.min(1 - x, rect.w + padX * 2),
    h: Math.min(1 - y, rect.h + padY * 2),
  };
}

/** True when the detection is too small to be a pack rather than a smudge. */
export function isPlausible(rect: { w: number; h: number }): boolean {
  return rect.w > 0.08 && rect.h > 0.08;
}

/**
 * Page run inside the canvas host. `__SRC__` is replaced with a data URI and
 * `__FN__` with the stringified scanner above, so both platforms trim with
 * exactly the same code.
 */
export function buildProbeHtml(dataUri: string, tolerance = DEFAULT_TOLERANCE): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>
<script>
(function () {
  var scan = ${scanForContent.toString()};
  function send(payload) {
    try {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }
  try {
    var img = new Image();
    img.onload = function () {
      try {
        var scale = Math.min(1, ${PROBE_MAX_EDGE} / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        send({ ok: true, rect: scan(ctx.getImageData(0, 0, w, h).data, w, h, ${tolerance}) });
      } catch (e) {
        send({ ok: false, error: String(e) });
      }
    };
    img.onerror = function () { send({ ok: false, error: 'decode failed' }); };
    img.src = ${JSON.stringify(dataUri)};
  } catch (e) {
    send({ ok: false, error: String(e) });
  }
})();
</script>
</body></html>`;
}

export type ProbeMessage = {
  ok: boolean;
  rect?: { x: number; y: number; w: number; h: number } | null;
  error?: string;
};

/** Turn a probe message into a crop worth suggesting, or null. */
export function toSuggestion(message: ProbeMessage): NormalizedRect | null {
  if (!message.ok || !message.rect) return null;
  if (!isPlausible(message.rect)) return null;
  return padDetection(message.rect);
}
