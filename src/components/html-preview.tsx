import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { reportError } from '@/lib/errors';

type Props = {
  html: string;
  /** Document page width in points. The document carries a matching viewport
   * meta tag, so the WebView scales it to fit on its own. */
  pageWidth: number;
};

/** Renders the generated catalog HTML exactly as the PDF engine will see it. */
export function HtmlPreview({ html, pageWidth }: Props) {
  void pageWidth;
  // Remounting is the only way back from a dead render process — the old
  // WebView instance stays blank forever.
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(() => {
    setFailure(null);
    setGeneration((n) => n + 1);
  }, []);

  if (failure) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Preview could not be shown</Text>
        <Text style={styles.fallbackText}>{failure}</Text>
        <Text style={styles.fallbackHint}>
          Exporting the PDF does not use this preview, so it may still work.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={reload}
          style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.85 : 1 }]}>
          <Text style={styles.retryText}>Reload preview</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <WebView
      key={generation}
      originWhitelist={['*']}
      source={{ html }}
      style={styles.web}
      scalesPageToFit
      setSupportMultipleWindows={false}
      startInLoadingState
      allowFileAccess
      allowUniversalAccessFromFileURLs
      // Android: the WebView renderer died — usually out of memory on a large
      // catalogue. Returning true tells the OS this was handled; without it the
      // whole app is killed with nothing logged on the JS side.
      onRenderProcessGone={(event) => {
        const didCrash = event.nativeEvent?.didCrash;
        reportError(
          'preview',
          new Error(`WebView render process gone (didCrash=${String(didCrash)})`)
        );
        setFailure(
          'The preview ran out of memory rendering this catalogue. Try a denser layout (3 or 4 per row) or a narrower selection.'
        );
        return true;
      }}
      // iOS equivalent of the above.
      onContentProcessDidTerminate={() => {
        reportError('preview', new Error('WebView content process terminated'));
        setFailure(
          'The preview ran out of memory rendering this catalogue. Try a denser layout (3 or 4 per row) or a narrower selection.'
        );
      }}
      onError={(event) => {
        const { description, code } = event.nativeEvent;
        reportError('preview', new Error(`WebView load error ${code}: ${description}`));
        setFailure(description || 'The preview document could not be loaded.');
      }}
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#1A73E8" />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#fff' },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
    backgroundColor: '#fff',
  },
  fallbackTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F1F1F',
    textAlign: 'center',
  },
  fallbackText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6368',
    textAlign: 'center',
  },
  fallbackHint: {
    fontSize: 12.5,
    lineHeight: 18,
    color: '#5F6368',
    textAlign: 'center',
  },
  retry: {
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
