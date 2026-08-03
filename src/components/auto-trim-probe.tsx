import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { buildProbeHtml, toSuggestion, type ProbeMessage } from '@/lib/auto-trim';
import type { NormalizedRect } from '@/lib/crop-geometry';

/** Give up rather than leave the editor waiting on a wedged WebView. */
const TIMEOUT_MS = 6000;

type Props = {
  /** Small data URI of the image to scan, or null to stay idle. */
  dataUri: string | null;
  /** Called exactly once per `dataUri`, with null when nothing was found. */
  onResult: (rect: NormalizedRect | null) => void;
};

/**
 * Off-screen canvas host for the auto-trim scan.
 *
 * React Native cannot read pixels, so the detection runs inside a WebView that
 * never becomes visible. Everything here is best effort: a failure, a decode
 * error or a timeout all report null, and the caller simply does not offer a
 * suggestion.
 */
export function AutoTrimProbe({ dataUri, onResult }: Props) {
  // Derived, not stored: the page is a pure function of the image to scan.
  const html = useMemo(() => (dataUri ? buildProbeHtml(dataUri) : null), [dataUri]);

  const onResultRef = useRef(onResult);
  const settled = useRef(false);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!dataUri) return;

    settled.current = false;
    const timer = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      onResultRef.current(null);
    }, TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      // Unmounting mid-scan must not fire a late callback into a dead screen.
      settled.current = true;
    };
  }, [dataUri]);

  const settle = (rect: NormalizedRect | null) => {
    if (settled.current) return;
    settled.current = true;
    onResultRef.current(rect);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let rect: NormalizedRect | null = null;
    try {
      rect = toSuggestion(JSON.parse(event.nativeEvent.data) as ProbeMessage);
    } catch {
      rect = null;
    }
    settle(rect);
  };

  if (!html) return null;

  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        onError={() => settle(null)}
        onHttpError={() => settle(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
});
