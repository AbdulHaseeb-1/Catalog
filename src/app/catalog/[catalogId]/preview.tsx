import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildPreviewHtml } from '@/services/pdf-service';

export default function PreviewScreen() {
  const { catalogId } = useLocalSearchParams<{ catalogId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!catalogId) return;
    setLoading(true);
    setError(null);
    try {
      const doc = await buildPreviewHtml(catalogId);
      setHtml(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build preview');
    } finally {
      setLoading(false);
    }
  }, [catalogId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
          <ThemedText themeColor="textSecondary" style={{ marginTop: 12 }}>
            Building layout preview…
          </ThemedText>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <ThemedText style={{ marginBottom: 12, textAlign: 'center' }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={load} />
        </View>
      ) : html ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.web}
          scalesPageToFit
          setSupportMultipleWindows={false}
          startInLoadingState
          allowFileAccess
          allowUniversalAccessFromFileURLs
        />
      ) : null}

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
        <Button title="Refresh" variant="ghost" onPress={load} style={{ flex: 1 }} />
        <Button
          title="Export PDF"
          variant="accent"
          onPress={() => router.push(`/catalog/${catalogId}/export`)}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  web: { flex: 1, backgroundColor: '#fff' },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
