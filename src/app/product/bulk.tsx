import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CroppedImage } from '@/components/cropped-image';
import { ImageCropper } from '@/components/image-cropper';
import { ReferencePicker } from '@/components/reference-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deriveCoverCrop } from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { pluralize } from '@/lib/text';
import { normalizeImportedImage, pickImages } from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';
import {
  cellAspectRatio,
  cropForLayout,
  hasContactDetails,
  layoutMeta,
  rotatedSize,
  type LayoutCrops,
  type LayoutId,
  type Rotation,
} from '@/types/models';

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Draft = {
  key: string;
  uri: string;
  size: { width: number; height: number } | null;
  formulaId: string | null;
  crops: LayoutCrops;
  rotation: Rotation;
};

/**
 * Import a batch of pack shots under one company.
 *
 * Building a catalogue means adding hundreds of products, and doing that one
 * form at a time is the slowest thing in the app. Here the company is chosen
 * once, and the per-photo work collapses to tapping a formula — with framing
 * copyable across the whole batch.
 */
export default function BulkImportScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ companyId?: string | string[] }>();

  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const products = useLibraryStore((s) => s.products);
  const addCompany = useLibraryStore((s) => s.addCompany);
  const addFormula = useLibraryStore((s) => s.addFormula);
  const addProducts = useLibraryStore((s) => s.addProducts);
  const exportSettings = useLibraryStore((s) => s.exportSettings);
  const brandContact = useLibraryStore((s) => s.brandContact);

  const [companyId, setCompanyId] = useState(param(params.companyId) ?? '');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  /** Layout open in the cropper for the current draft. */
  const [cropLayout, setCropLayout] = useState<LayoutId>('2x2');
  const [sessionInitialCrop, setSessionInitialCrop] = useState<
    import('@/lib/crop-geometry').NormalizedRect | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contactBox =
    exportSettings.includeContactBox && hasContactDetails(brandContact);

  const pageContext = {
    layoutId: cropLayout,
    pageSize: exportSettings.pageSize,
    contactBox,
  };

  const companyOptions = useMemo(
    () =>
      companies.map((company) => ({
        id: company.id,
        name: company.name,
        meta: company.productCount ? pluralize(company.productCount, 'product') : 'No products yet',
      })),
    [companies]
  );

  const formulaOptions = useMemo(
    () => formulas.map((formula) => ({ id: formula.id, name: formula.name })),
    [formulas]
  );

  const formulaName = useCallback(
    (id: string | null) => (id ? (formulas.find((f) => f.id === id)?.name ?? null) : null),
    [formulas]
  );

  /** Pick photos, then normalise each so its pixels stand upright on their own. */
  const pick = useCallback(async () => {
    setError(null);
    setPicking(true);
    try {
      const uris = await pickImages({ multiple: true });
      if (!uris.length) return;

      const prepared: Draft[] = [];
      for (const uri of uris) {
        try {
          const normalized = await normalizeImportedImage(uri);
          prepared.push({
            key: `${normalized.uri}-${prepared.length}-${Date.now()}`,
            uri: normalized.uri,
            size: { width: normalized.width, height: normalized.height },
            formulaId: null,
            crops: {},
            rotation: 0,
          });
        } catch (e) {
          // One unreadable photo should not cost the user the whole selection.
          reportError('image', e);
        }
      }

      setDrafts((current) => [...current, ...prepared]);
      if (prepared.length < uris.length) {
        setError(`${uris.length - prepared.length} photo(s) could not be read and were skipped.`);
      }
    } catch (e) {
      reportError('image', e);
      Alert.alert('Could not open the picker', toMessage(e));
    } finally {
      setPicking(false);
    }
  }, []);

  // Open the picker as soon as the screen appears — that is what it is for.
  // Deferred past the first commit so presenting the system sheet is not part
  // of rendering this screen.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) void pick();
    })();
    return () => {
      cancelled = true;
    };
  }, [pick]);

  const patch = (key: string, next: Partial<Draft>) => {
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...next } : d)));
  };

  const remove = (key: string) => {
    setDrafts((current) => current.filter((d) => d.key !== key));
  };

  const editingDraft = drafts.find((d) => d.key === editing) ?? null;

  /** Stamp one photo's framing onto every other shot in the batch. */
  const copyFramingToAll = (source: Draft) => {
    setDrafts((current) =>
      current.map((d) =>
        d.key === source.key
          ? d
          : { ...d, crops: { ...source.crops }, rotation: source.rotation }
      )
    );
  };

  const previewLayout = exportSettings.layoutId as LayoutId;

  const openBulkCropper = (draft: Draft, layout: LayoutId) => {
    let initial = cropForLayout({ crops: draft.crops }, layout);
    if (!initial && draft.size) {
      const other: LayoutId = layout === '2x2' ? '2x3' : '2x2';
      const otherCrop = cropForLayout({ crops: draft.crops }, other);
      if (otherCrop) {
        initial = deriveCoverCrop(
          otherCrop,
          rotatedSize(draft.size, draft.rotation),
          cellAspectRatio({
            layoutId: layout,
            pageSize: exportSettings.pageSize,
            contactBox,
          })
        );
      }
    }
    setSessionInitialCrop(initial);
    setCropLayout(layout);
    setEditing(draft.key);
  };

  const layoutName = layoutMeta(cropLayout).name;

  const ready = drafts.filter((d) => {
    if (!d.formulaId) return false;
    // Drop rows that would hit unique company+formula (batch or library).
    const batchDup = drafts.some(
      (other) => other.key !== d.key && other.formulaId === d.formulaId
    );
    if (batchDup) {
      // Keep the first occurrence of each formula in the list.
      const first = drafts.find((x) => x.formulaId === d.formulaId);
      if (first && first.key !== d.key) return false;
    }
    if (
      companyId &&
      products.some((p) => p.companyId === companyId && p.formulaId === d.formulaId)
    ) {
      return false;
    }
    return true;
  });
  const skippedDupes = drafts.filter((d) => d.formulaId).length - ready.length;
  const canSave = !!companyId && ready.length > 0 && !saving;

  const save = async () => {
    if (!companyId) return setError('Choose the company these packs belong to.');
    if (!ready.length) {
      return setError(
        skippedDupes > 0
          ? 'Every photo is a duplicate formula for this company. Change formulas or remove rows.'
          : 'Give at least one photo a formula.'
      );
    }

    setSaving(true);
    setError(null);
    setProgress({ done: 0, total: ready.length });
    try {
      const result = await addProducts({
        companyId,
        items: ready.map((d) => ({
          sourceUri: d.uri,
          formulaId: d.formulaId as string,
          crops: d.crops,
          rotation: d.rotation,
          sourceSize: d.size,
        })),
        onProgress: (done, total) => setProgress({ done, total }),
      });

      if (result.failures.length) {
        Alert.alert(
          'Imported with problems',
          `${pluralize(result.added, 'product')} added. ${result.failures.length} could not be saved.`
        );
      }
      router.back();
    } catch (e) {
      setError(toMessage(e, 'Could not import those products.'));
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const renderDraft = ({ item }: { item: Draft }) => {
    const name = formulaName(item.formulaId);
    const batchClash =
      !!item.formulaId &&
      drafts.some((d) => d.key !== item.key && d.formulaId === item.formulaId);
    const libraryClash =
      !!companyId &&
      !!item.formulaId &&
      products.some((p) => p.companyId === companyId && p.formulaId === item.formulaId);
    return (
      <View
        style={[
          styles.row,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <Pressable
          onPress={() => openBulkCropper(item, '2x2')}
          accessibilityRole="button">
          <CroppedImage
            uri={item.uri}
            crop={cropForLayout({ crops: item.crops }, previewLayout)}
            sourceSize={item.size}
            rotation={item.rotation}
            style={[styles.thumb, { borderColor: theme.border }]}
          />
        </Pressable>

        <View style={styles.rowBody}>
          <ReferencePicker
            label=""
            placeholder="Tap to choose a formula"
            options={formulaOptions}
            value={item.formulaId ?? undefined}
            onChange={(id) => patch(item.key, { formulaId: id })}
            onCreate={async (newName) => addFormula(newName)}
            sheetTitle="Select formula"
            sheetSubtitle="Search, or add one that is not on the list yet."
            noun="formula"
            emptyHint="No formulas yet — type a name to add the first one."
          />
          <View style={styles.rowActions}>
            <Pressable onPress={() => openBulkCropper(item, '2x2')} hitSlop={6}>
              <ThemedText style={[styles.rowAction, { color: theme.primary }]}>
                Crop 2×2
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => openBulkCropper(item, '2x3')} hitSlop={6}>
              <ThemedText style={[styles.rowAction, { color: theme.primary }]}>
                Crop 2×3
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => copyFramingToAll(item)} hitSlop={6}>
              <ThemedText style={[styles.rowAction, { color: theme.primary }]}>
                Use framing for all
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => remove(item.key)} hitSlop={6}>
              <ThemedText style={[styles.rowAction, { color: theme.danger }]}>Remove</ThemedText>
            </Pressable>
          </View>
          {!name ? (
            <ThemedText themeColor="textSecondary" style={styles.rowWarn}>
              Needs a formula before it can be imported.
            </ThemedText>
          ) : null}
          {batchClash ? (
            <ThemedText style={[styles.rowWarn, { color: theme.danger }]}>
              Another photo in this batch uses the same formula — only one can be imported.
            </ThemedText>
          ) : null}
          {libraryClash ? (
            <ThemedText style={[styles.rowWarn, { color: theme.danger }]}>
              This company already has that formula. Change the formula or remove this photo.
            </ThemedText>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        data={drafts}
        keyExtractor={(item) => item.key}
        renderItem={renderDraft}
        contentContainerStyle={[styles.list, { paddingBottom: Spacing.six }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ReferencePicker
              label="Company"
              placeholder="Select a company"
              options={companyOptions}
              value={companyId || undefined}
              onChange={(id) => {
                setCompanyId(id);
                setError(null);
              }}
              onCreate={async (name) => addCompany({ name })}
              sheetTitle="Select company"
              sheetSubtitle="Every photo in this batch is filed under it."
              noun="company"
              nounPlural="companies"
              emptyHint="No companies yet — type a name to add the first one."
            />
            <ThemedText themeColor="textSecondary" style={styles.headerHint}>
              Crop 2×2 then 2×3 for each photo — pan, pinch and rotate for the best angle on
              both grids. Copy framing stamps both onto the rest of the batch.
            </ThemedText>
            <Button
              title={picking ? 'Opening photos…' : 'Add more photos'}
              variant="secondary"
              loading={picking}
              onPress={pick}
            />
          </View>
        }
        ListEmptyComponent={
          picking ? (
            <View style={styles.empty}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <ThemedText style={styles.emptyTitle}>No photos yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.emptyHint}>
                Pick several pack shots at once — you only tag the formulas.
              </ThemedText>
            </View>
          )
        }
      />

      {error ? (
        <ThemedText style={[styles.error, { color: theme.danger }]}>{error}</ThemedText>
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
        <ThemedText themeColor="textSecondary" style={styles.footerCount}>
          {progress
            ? `Importing ${progress.done} of ${progress.total}…`
            : `${ready.length} of ${drafts.length} ready`}
        </ThemedText>
        <Button
          title={`Import ${ready.length || ''}`.trim()}
          variant="primary"
          loading={saving}
          disabled={!canSave}
          onPress={save}
          style={styles.footerButton}
        />
      </View>

      <Modal
        visible={!!editingDraft}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setEditing(null);
          setSessionInitialCrop(null);
        }}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {editingDraft ? (
            <ImageCropper
              key={`${editingDraft.key}-${cropLayout}`}
              uri={editingDraft.uri}
              initialCrop={sessionInitialCrop}
              initialRotation={editingDraft.rotation}
              page={pageContext}
              title={`Crop for ${layoutName}`}
              subtitle={
                cropLayout === '2x3'
                  ? '2 × 3 — pan, pinch and rotate for the best angle'
                  : formulaName(editingDraft.formulaId) ?? 'Not tagged yet'
              }
              confirmLabel={
                cropLayout === '2x2' && !cropForLayout({ crops: editingDraft.crops }, '2x3')
                  ? 'Next: adjust 2 × 3'
                  : 'Use this crop'
              }
              onCancel={() => {
                setEditing(null);
                setSessionInitialCrop(null);
              }}
              onConfirm={({ crop, sourceSize, rotation }) => {
                const nextCrops: LayoutCrops = {
                  ...editingDraft.crops,
                  [cropLayout]: crop,
                };
                const updated: Draft = {
                  ...editingDraft,
                  crops: nextCrops,
                  rotation,
                  size: sourceSize,
                };
                patch(editingDraft.key, {
                  crops: nextCrops,
                  rotation,
                  size: sourceSize,
                });

                if (cropLayout === '2x2' && !cropForLayout({ crops: nextCrops }, '2x3')) {
                  openBulkCropper(updated, '2x3');
                  return;
                }
                setEditing(null);
                setSessionInitialCrop(null);
              }}
            />
          ) : null}
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: {
    width: '100%',
    maxWidth: Screen.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  headerHint: { fontSize: 12.5, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: Radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: Spacing.one },
  rowActions: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
  rowAction: { fontSize: 12.5, fontWeight: '600' },
  rowWarn: { fontSize: 11.5 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: Spacing.six },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
  error: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: Screen.padX,
    paddingBottom: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerCount: { flex: 1, fontSize: 13 },
  footerButton: { minWidth: 140 },
});
