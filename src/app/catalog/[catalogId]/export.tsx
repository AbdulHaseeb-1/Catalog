import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { generatePdf, sharePdf } from '@/services/pdf-service';
import { useCatalogStore } from '@/stores/catalog-store';
import { layoutMeta } from '@/types/models';

function param(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default function ExportScreen() {
  const params = useLocalSearchParams<{ catalogId?: string | string[] }>();
  const catalogId = param(params.catalogId);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const catalog = useCatalogStore((s) => s.activeCatalog);
  const loadCatalog = useCatalogStore((s) => s.loadCatalog);
  const [status, setStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [webPrint, setWebPrint] = useState(false);

  useEffect(() => {
    if (catalogId && (!catalog || catalog.id !== catalogId)) {
      loadCatalog(catalogId);
    }
  }, [catalogId, catalog, loadCatalog]);

  const layout = catalog ? layoutMeta(catalog.layoutId) : null;

  const onGenerate = async () => {
    if (!catalogId) return;
    setStatus('generating');
    setMessage(null);
    setPdfUri(null);
    setWebPrint(false);
    try {
      const result = await generatePdf(catalogId);
      if (result.webPrint) {
        setWebPrint(true);
        setStatus('ready');
        setMessage(
          'Print dialog opened. Choose “Save as PDF” in your browser to download the catalog.'
        );
        return;
      }
      setPdfUri(result.uri);
      setStatus('ready');
      const pages =
        result.numberOfPages != null
          ? ` (${result.numberOfPages} page${result.numberOfPages === 1 ? '' : 's'})`
          : '';
      setMessage(`PDF ready${pages}. Tap Share to send or save it.`);
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'PDF generation failed');
    }
  };

  const onShare = async () => {
    if (!pdfUri) return;
    try {
      await sharePdf(pdfUri);
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Sharing failed');
    }
  };

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.background,
          paddingHorizontal: Screen.padX,
          paddingTop: Spacing.three,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
        },
      ]}>
      <View
        style={[
          styles.card,
          Elevation.card,
          { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
        ]}>
        <View style={[styles.iconBubble, { backgroundColor: theme.primaryMuted }]}>
          <ThemedText style={styles.emoji}>📄</ThemedText>
        </View>
        <ThemedText style={styles.title}>Export PDF</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.body}>
          {catalog
            ? `“${catalog.title}” · ${catalog.photos.length} photos · ${layout?.name ?? 'layout'}`
            : 'Generate a photo catalog PDF.'}
        </ThemedText>

        <View style={[styles.checklist, { borderColor: theme.border }]}>
          <CheckItem text="Cover with brand logo" color={theme.primary} />
          <CheckItem text={`Layout: ${layout?.name ?? '2×2 grid'}`} color={theme.primary} />
          <CheckItem text="Subtle borders between photos" color={theme.primary} />
          <CheckItem
            text={
              Platform.OS === 'web'
                ? 'Web: print dialog → Save as PDF'
                : 'Native: PDF file + share sheet'
            }
            color={theme.primary}
          />
        </View>

        {message ? (
          <ThemedText
            style={[
              styles.message,
              { color: status === 'error' ? theme.danger : theme.success },
            ]}>
            {message}
          </ThemedText>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={status === 'ready' ? 'Generate again' : 'Generate PDF'}
            variant="primary"
            loading={status === 'generating'}
            onPress={onGenerate}
          />
          {pdfUri && !webPrint ? (
            <Button title="Share PDF" variant="secondary" onPress={onShare} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function CheckItem({ text, color }: { text: string; color: string }) {
  return (
    <ThemedText style={styles.checkItem}>
      <ThemedText style={{ color, fontWeight: '700' }}>✓ </ThemedText>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  iconBubble: {
    width: 64,
    height: 64,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  emoji: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: -4,
  },
  checklist: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
    gap: 10,
  },
  checkItem: {
    fontSize: 14,
    lineHeight: 20,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 20,
  },
  actions: {
    gap: 10,
  },
});
