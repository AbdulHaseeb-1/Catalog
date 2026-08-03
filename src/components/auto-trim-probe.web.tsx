import { useEffect, useRef } from 'react';

import {
  PROBE_MAX_EDGE,
  DEFAULT_TOLERANCE,
  isPlausible,
  padDetection,
  scanForContent,
} from '@/lib/auto-trim';
import type { NormalizedRect } from '@/lib/crop-geometry';

type Props = {
  dataUri: string | null;
  onResult: (rect: NormalizedRect | null) => void;
};

/**
 * Web has a canvas of its own, so the scan runs directly against the DOM —
 * same detector as the native probe, without the WebView in between.
 */
export function AutoTrimProbe({ dataUri, onResult }: Props) {
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!dataUri || typeof document === 'undefined') return;

    let cancelled = false;
    const image = new window.Image();

    image.onload = () => {
      if (cancelled) return;
      try {
        const scale = Math.min(1, PROBE_MAX_EDGE / Math.max(image.width, image.height));
        const w = Math.max(1, Math.round(image.width * scale));
        const h = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return onResultRef.current(null);

        ctx.drawImage(image, 0, 0, w, h);
        const found = scanForContent(ctx.getImageData(0, 0, w, h).data, w, h, DEFAULT_TOLERANCE);
        onResultRef.current(found && isPlausible(found) ? padDetection(found) : null);
      } catch {
        // A tainted canvas or a decode failure just means no suggestion.
        onResultRef.current(null);
      }
    };
    image.onerror = () => {
      if (!cancelled) onResultRef.current(null);
    };
    image.src = dataUri;

    return () => {
      cancelled = true;
    };
  }, [dataUri]);

  return null;
}
