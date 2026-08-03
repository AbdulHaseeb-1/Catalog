import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HtmlPreview } from '@/components/html-preview';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { reportError, toMessage } from '@/lib/errors';
import { pluralize } from '@/lib/text';
import { buildPreviewHtml, generatePdf, sharePdf } from '@/services/pdf-service';
import { useLibraryStore } from '@/stores/library-store';
import { pageDimensions, type CatalogDocument, type CatalogScope } from '@/types/models';

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseScope(kind: string | undefined, id: string | undefined): CatalogScope | null {
  switch (kind) {
    case 'company':
      return id ? { kind: 'company', id } : null;
    case 'formula':
      return id ? { kind: 'formula', id } : null;
    case 'all-companies':
      return { kind: 'all-companies' };
    case 'all-formulas':
      return { kind: 'all-formulas' };
    default:
      return null;
  }
}

export default function ExportPreviewScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string | string[]; id?: string | string[] }>();
  const settings = useLibraryStore((s) => s.exportSettings);
  const contact = useLibraryStore((s) => s.brandContact);

  const scope = useMemo(
    () => parseScope(param(params.kind), param(params.id)),
    [params.kind, params.id]
  );

  const [html, setHtml] = useState<string | null>(null);
  const [doc, setDoc] = useState<CatalogDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!scope) {
      setError('Nothing was selected to export.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setPdfUri(null);
    setMessage(null);
    try {
      const result = await buildPreviewHtml(scope, settings, contact);
      setHtml(result.html);
      setDoc(result.document);
      setPageCount(result.pageCount);
    } catch (e) {
      setHtml(null);
      reportError('pdf', e);
      setError(toMessage(e, 'Could not build the preview.'));
    } finally {
      setLoading(false);
    }
  }, [scope, settings, contact]);

  useEffect(() => {
    load();
  }, [load]);

  const onExport = async () => {
    if (!scope) return;
    setExporting(true);
    setMessage(null);
    try {
      const result = await generatePdf(scope, settings, contact);
      if (result.webPrint) {
        setMessage({
          text: 'Print dialog opened — choose “Save as PDF” to download the catalogue.',
          failed: false,
        });
      } else {
        setPdfUri(result.uri);
        const pages =
          result.numberOfPages != null ? ` · ${pluralize(result.numberOfPages, 'page')}` : '';
        setMessage({ text: `PDF ready${pages}. Tap Share to send or save it.`, failed: false });
      }
    } catch (e) {
      setMessage({
        text: toMessage(e, 'PDF generation failed.'),
        failed: true,
      });
    } finally {
      setExporting(false);
    }
  };

  const onShare = async () => {
    if (!pdfUri) return;
    try {
      await sharePdf(pdfUri);
    } catch (e) {
      reportError('pdf', e);
      setMessage({ text: toMessage(e, 'Sharing failed.'), failed: true });
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {doc ? (
        <View style={[styles.summary, { borderBottomColor: theme.border }]}>
          <View style={styles.summaryText}>
            <ThemedText style={styles.summaryTitle} numberOfLines={1}>
              {doc.title}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.summaryMeta} numberOfLines={2}>
              {doc.subtitle}
            </ThemedText>
          </View>
          <View style={[styles.badge, { backgroundColor: theme.primaryMuted }]}>
            <ThemedText style={[styles.badgeText, { color: theme.primary }]}>
              {pageCount}
            </ThemedText>
            <ThemedText style={[styles.badgeLabel, { color: theme.primary }]}>pages</ThemedText>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
          <ThemedText themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
            Building the catalogue…
          </ThemedText>
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.center}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
          <Button title="Try again" variant="secondary" onPress={load} />
        </ScrollView>
      ) : html ? (
        <HtmlPreview html={html} pageWidth={pageDimensions(settings).width} />
      ) : null}

      {message ? (
        <ThemedText
          style={[
            styles.message,
            { color: message.failed ? theme.danger : theme.success },
          ]}>
          {message.text}
        </ThemedText>
      ) : null}

      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.border,
            backgroundColor: theme.background,
            paddingBottom: Math.max(insets.bottom, Spacing.three),
          },
        ]}>
        <Button title="Refresh" variant="ghost" onPress={load} style={{ flex: 1 }} />
        {pdfUri ? (
          <Button title="Share PDF" variant="secondary" onPress={onShare} style={{ flex: 1.2 }} />
        ) : null}
        <Button
          title={pdfUri ? 'Export again' : 'Export PDF'}
          variant="accent"
          loading={exporting}
          disabled={!html}
          onPress={onExport}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Screen.padX,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryText: { flex: 1, gap: 2 },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  summaryMeta: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  badge: {
    minWidth: 58,
    borderRadius: Radii.md,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 16,
    fontWeight: '800',
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  message: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.three,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
