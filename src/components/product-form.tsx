import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CellPreview } from '@/components/cell-preview';
import { CroppedImage } from '@/components/cropped-image';
import { ImageCropper } from '@/components/image-cropper';
import { ReferencePicker } from '@/components/reference-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deriveCoverCrop, effectiveCrop, type NormalizedRect } from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { pluralize } from '@/lib/text';
import {
  normalizeImportedImage,
  pickImage,
  resolveImageUri,
  takePhoto,
} from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';
import {
  LAYOUTS,
  assessResolution,
  cellAspectRatio,
  cropForLayout,
  hasContactDetails,
  layoutMeta,
  gridCellSizeMm,
  recommendedSourcePixels,
  rotatedSize,
  type LayoutCrops,
  type LayoutId,
  type Rotation,
} from '@/types/models';

export type ProductFormValues = {
  companyId: string;
  formulaId: string;
  /** Set only when the user picked a new image. */
  sourceUri?: string;
  /**
   * Framing per layout. `undefined` leaves existing crops untouched on edit;
   * when set, replaces the map (new image always sends a full map).
   */
  crops?: LayoutCrops;
  /**
   * Measured pixel size of the image the crop was drawn on. Products saved
   * before crops existed have no dimensions recorded, and without them a crop
   * cannot be turned back into pixels.
   */
  sourceSize?: { width: number; height: number } | null;
  /** Quarter turns to apply before the crop. */
  rotation?: Rotation;
};

type Props = {
  mode: 'create' | 'edit';
  initialCompanyId?: string;
  initialFormulaId?: string;
  /** Stored image path, shown until the user picks a replacement. */
  initialImageUri?: string;
  /** Existing framing for `initialImageUri`. */
  initialCrops?: LayoutCrops;
  /** Pixel size of the stored image, needed to place crops. */
  initialImageSize?: { width: number; height: number } | null;
  /** Existing rotation for `initialImageUri`. */
  initialRotation?: Rotation;
  /** Product being edited — excluded from the duplicate check. */
  productId?: string;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  /** Extra actions rendered under the primary button (delete). */
  footer?: ReactNode;
};

/**
 * The whole product form: a company, a formula, and an image. Framing is saved
 * once per page layout (2×2 and 2×3) so export can pick the matching crop.
 */
export function ProductForm({
  mode,
  initialCompanyId,
  initialFormulaId,
  initialImageUri,
  initialCrops,
  initialImageSize,
  initialRotation = 0,
  productId,
  submitLabel,
  onSubmit,
  footer,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const products = useLibraryStore((s) => s.products);
  const addCompany = useLibraryStore((s) => s.addCompany);
  const addFormula = useLibraryStore((s) => s.addFormula);
  const exportSettings = useLibraryStore((s) => s.exportSettings);
  const brandContact = useLibraryStore((s) => s.brandContact);

  const [companyId, setCompanyId] = useState(initialCompanyId ?? '');
  const [formulaId, setFormulaId] = useState(initialFormulaId ?? '');
  const [sourceUri, setSourceUri] = useState<string | null>(null);
  /** undefined = unchanged from initial (edit); object = user-set map. */
  const [crops, setCrops] = useState<LayoutCrops | undefined>(undefined);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(
    initialImageSize ?? null
  );
  const [rotation, setRotation] = useState<Rotation | undefined>(undefined);
  /** Which layout the form preview is showing. */
  const [framingLayout, setFramingLayout] = useState<LayoutId>('2x2');
  /**
   * Layout currently open in the full-screen cropper. Kept separate from
   * framingLayout so opening 2×3 always uses the 2×3 cell (no stale state).
   */
  const [croppingLayout, setCroppingLayout] = useState<LayoutId | null>(null);
  /** Initial rect for the open cropper session (seeded before mount). */
  const [sessionInitialCrop, setSessionInitialCrop] = useState<NormalizedRect | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    () =>
      formulas.map((formula) => ({
        id: formula.id,
        name: formula.name,
        meta: formula.productCount
          ? `${pluralize(formula.productCount, 'product')} · ${pluralize(
              formula.companyCount,
              'company',
              'companies'
            )}`
          : 'No products yet',
      })),
    [formulas]
  );

  const previewUri = sourceUri ?? resolveImageUri(initialImageUri);
  const hasImage = !!previewUri;

  const activeCrops: LayoutCrops = crops ?? initialCrops ?? {};
  const activeCrop = cropForLayout({ crops: activeCrops }, framingLayout);
  const activeRotation = rotation === undefined ? initialRotation : rotation;

  const contactBox =
    exportSettings.includeContactBox && hasContactDetails(brandContact);

  const pageContext = {
    layoutId: framingLayout,
    pageSize: exportSettings.pageSize,
    contactBox,
  };

  const meta = layoutMeta(framingLayout);
  const cellAspect = cellAspectRatio(pageContext);
  const perfectSize = recommendedSourcePixels(pageContext);
  const cellMm = gridCellSizeMm(pageContext);

  const cropPixels = useMemo(() => {
    if (!imageSize) return null;
    return effectiveCrop(activeCrop, rotatedSize(imageSize, activeRotation));
  }, [activeCrop, imageSize, activeRotation]);

  const resolution = useMemo(
    () => (cropPixels ? assessResolution(cropPixels, pageContext) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cropPixels, pageContext.layoutId, pageContext.pageSize, pageContext.contactBox]
  );

  const duplicate = useMemo(() => {
    if (!companyId || !formulaId) return false;
    return products.some(
      (product) =>
        product.companyId === companyId &&
        product.formulaId === formulaId &&
        product.id !== productId
    );
  }, [products, companyId, formulaId, productId]);

  /**
   * Open the cropper for a layout. Seeds from that layout’s saved crop, or
   * derives a starting window from the other layout so 2×3 is adjustable from
   * a sensible place rather than the full frame.
   */
  const openCropper = (
    layout: LayoutId,
    map?: LayoutCrops,
    size?: { width: number; height: number } | null,
    rot?: Rotation
  ) => {
    const cropMap = map ?? crops ?? initialCrops ?? {};
    const dims = size ?? imageSize;
    const turn = rot ?? activeRotation;
    let initial = cropForLayout({ crops: cropMap }, layout);
    if (!initial && dims) {
      const other: LayoutId = layout === '2x2' ? '2x3' : '2x2';
      const otherCrop = cropForLayout({ crops: cropMap }, other);
      if (otherCrop) {
        initial = deriveCoverCrop(
          otherCrop,
          rotatedSize(dims, turn),
          cellAspectRatio({
            layoutId: layout,
            pageSize: exportSettings.pageSize,
            contactBox,
          })
        );
      }
    }
    setSessionInitialCrop(initial);
    setFramingLayout(layout);
    setCroppingLayout(layout);
  };

  const closeCropper = () => {
    setCroppingLayout(null);
    setSessionInitialCrop(null);
  };

  /**
   * Pick or shoot, then frame 2×2 then 2×3. Both steps use pan / pinch /
   * rotate so each grid gets the best angle for its cell shape.
   */
  const choose = async (source: 'library' | 'camera') => {
    setError(null);
    try {
      const picked = source === 'camera' ? await takePhoto() : await pickImage();
      if (!picked) return;

      setPreparing(true);
      const normalized = await normalizeImportedImage(picked);
      const size = { width: normalized.width, height: normalized.height };

      setSourceUri(normalized.uri);
      setImageSize(size);
      setCrops({ '2x2': null, '2x3': null });
      setRotation(0);
      openCropper('2x2', {}, size, 0);
    } catch (e) {
      reportError('image', e);
      Alert.alert('Could not open that photo', toMessage(e));
    } finally {
      setPreparing(false);
    }
  };

  const submit = async () => {
    if (!companyId) return setError('Select a company.');
    if (!formulaId) return setError('Select a formula.');
    if (!hasImage) return setError('Add a photo of the pack.');

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        companyId,
        formulaId,
        sourceUri: sourceUri ?? undefined,
        crops,
        sourceSize: imageSize,
        rotation,
      });
    } catch (e) {
      setError(toMessage(e, 'Could not save this product.'));
    } finally {
      setSaving(false);
    }
  };

  const cropSessionPage =
    croppingLayout != null
      ? {
          layoutId: croppingLayout,
          pageSize: exportSettings.pageSize,
          contactBox,
        }
      : pageContext;
  const cropSessionMeta = layoutMeta(cropSessionPage.layoutId);

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.five },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasImage ? 'Change product photo' : 'Add product photo'}
          onPress={() => choose('library')}
          style={({ pressed }) => [
            styles.imageCard,
            {
              backgroundColor: theme.bubble,
              borderColor: hasImage ? theme.border : theme.primary,
              borderStyle: hasImage ? 'solid' : 'dashed',
              opacity: pressed ? 0.9 : 1,
            },
          ]}>
          {previewUri ? (
            <CroppedImage
              uri={previewUri}
              crop={activeCrop}
              sourceSize={imageSize}
              rotation={activeRotation}
              style={styles.image}
              accessibilityLabel="Product photo"
            />
          ) : (
            <View style={styles.imageEmpty}>
              <ThemedText style={styles.imageEmoji}>📷</ThemedText>
              <ThemedText style={styles.imageTitle}>Add the pack shot</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.imageHint}>
                Tap to choose from your photos
              </ThemedText>
            </View>
          )}
        </Pressable>

        <View style={styles.imageActions}>
          <Button
            title={hasImage ? 'Change photo' : 'Choose photo'}
            variant="secondary"
            loading={preparing}
            disabled={preparing}
            onPress={() => choose('library')}
            style={{ flex: 1 }}
          />
          <Button
            title="Camera"
            variant="ghost"
            disabled={preparing}
            onPress={() => choose('camera')}
            style={{ flex: 1 }}
          />
        </View>

        {hasImage ? (
          <View style={styles.framingBlock}>
            <ThemedText style={styles.framingLabel}>Frame for each page layout</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.framingHint}>
              {exportSettings.layoutId === '2x3'
                ? 'Your PDF layout is 2 × 3 — you will frame that cell after 2 × 2. You can still adjust either grid anytime.'
                : 'Your PDF layout is 2 × 2 — finishing a crop also sets a 2 × 3 framing you can fine-tune later.'}{' '}
              Export uses the crop for the grid you pick on Generate.
            </ThemedText>
            {/* Side-by-side previews of both grids */}
            <View style={styles.dualPreview}>
              {LAYOUTS.map((layout) => {
                const c = cropForLayout({ crops: activeCrops }, layout.id);
                const aspect = cellAspectRatio({
                  layoutId: layout.id,
                  pageSize: exportSettings.pageSize,
                  contactBox,
                });
                const h = 72;
                const w = h * aspect;
                return (
                  <Pressable
                    key={layout.id}
                    onPress={() => openCropper(layout.id)}
                    style={[
                      styles.dualCard,
                      {
                        borderColor:
                          framingLayout === layout.id ? theme.primary : theme.border,
                        backgroundColor: theme.bubble,
                      },
                    ]}>
                    <View
                      style={{
                        width: w,
                        height: h,
                        borderRadius: 4,
                        overflow: 'hidden',
                        backgroundColor: '#fff',
                      }}>
                      <CroppedImage
                        uri={previewUri}
                        crop={c}
                        sourceSize={imageSize}
                        rotation={activeRotation}
                        style={StyleSheet.absoluteFillObject}
                        transition={0}
                      />
                    </View>
                    <ThemedText style={styles.dualLabel}>
                      {layout.name}
                      {c ? ' ✓' : ''}
                    </ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.dualHint}>
                      Tap to adjust
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.cropActions}>
              {LAYOUTS.map((layout) => {
                const framed = cropForLayout({ crops: activeCrops }, layout.id) != null;
                return (
                  <Button
                    key={layout.id}
                    title={framed ? `Adjust ${layout.name}` : `Crop ${layout.name}`}
                    variant={framingLayout === layout.id ? 'secondary' : 'ghost'}
                    onPress={() => openCropper(layout.id)}
                    style={styles.cropActionBtn}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        {hasImage ? (
          <CellPreview
            uri={previewUri}
            crop={activeCrop}
            sourceSize={imageSize}
            rotation={activeRotation}
            cellAspect={cellAspect}
            columns={meta.columns}
            rows={meta.rows}
            layoutName={meta.name}
            cropPixels={cropPixels}
            perfectSize={perfectSize}
            cellMm={cellMm}
            resolution={resolution}
            expanded={previewOpen}
            onToggle={() => setPreviewOpen((v) => !v)}
          />
        ) : (
          <ThemedText themeColor="textSecondary" style={styles.sizeHint}>
            Best photo size for {meta.name}: {perfectSize.width} × {perfectSize.height} px (
            ~{cellMm.widthMm} × {cellMm.heightMm} mm at print). Frame after you pick a photo.
          </ThemedText>
        )}

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
          sheetSubtitle="Search, or add one that is not on the list yet."
          noun="company"
          nounPlural="companies"
          emptyHint="No companies yet — type a name to add the first one."
        />

        <ReferencePicker
          label="Formula"
          placeholder="Select a formula"
          options={formulaOptions}
          value={formulaId || undefined}
          onChange={(id) => {
            setFormulaId(id);
            setError(null);
          }}
          onCreate={async (name) => addFormula(name)}
          sheetTitle="Select formula"
          sheetSubtitle="Search, or add one that is not on the list yet."
          noun="formula"
          emptyHint="No formulas yet — type a name to add the first one."
        />

        {duplicate ? (
          <ThemedText themeColor="textSecondary" style={styles.notice}>
            This company already has a product for that formula. Adding another is fine — both
            images will appear in the catalogue.
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText style={[styles.error, { color: theme.danger }]}>{error}</ThemedText>
        ) : null}

        <Button
          title={submitLabel}
          variant="primary"
          loading={saving}
          onPress={submit}
          style={styles.submit}
        />

        {mode === 'edit' ? footer : null}
      </ScrollView>

      <Modal
        visible={croppingLayout != null && !!previewUri}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeCropper}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {croppingLayout && previewUri ? (
            <ImageCropper
              key={`${croppingLayout}-${previewUri}`}
              uri={previewUri}
              initialCrop={sessionInitialCrop}
              initialRotation={activeRotation}
              page={cropSessionPage}
              title={`Crop for ${cropSessionMeta.name}`}
              subtitle={
                croppingLayout === '2x3'
                  ? '2 × 3 cell — pan, pinch and rotate until the pack sits right'
                  : `One cell of the ${cropSessionMeta.name} page — pan, pinch and rotate`
              }
              confirmLabel={
                croppingLayout === '2x2' &&
                exportSettings.layoutId === '2x3' &&
                !cropForLayout({ crops: activeCrops }, '2x3')
                  ? 'Next: adjust 2 × 3'
                  : croppingLayout === '2x2' && !cropForLayout({ crops: activeCrops }, '2x3')
                    ? 'Use crop (sets both grids)'
                    : 'Use this crop'
              }
              onCancel={closeCropper}
              onConfirm={({ crop: next, sourceSize, rotation: nextRotation }) => {
                setImageSize(sourceSize);
                setRotation(nextRotation);
                const layout = croppingLayout;
                let nextMap: LayoutCrops = {
                  ...(crops ?? initialCrops ?? {}),
                  [layout]: next,
                };

                // When export layout is 2×3 and 2×3 is still empty, open the
                // adjustable 2×3 cropper. When export is 2×2 (or 2×3 already
                // set), derive the other layout so both print without forcing
                // a second full crop session — user can still Adjust 2×3 later.
                if (layout === '2x2' && !cropForLayout({ crops: nextMap }, '2x3')) {
                  if (exportSettings.layoutId === '2x3') {
                    setCrops(nextMap);
                    openCropper('2x3', nextMap, sourceSize, nextRotation);
                    return;
                  }
                  const derived = deriveCoverCrop(
                    next,
                    rotatedSize(sourceSize, nextRotation),
                    cellAspectRatio({
                      layoutId: '2x3',
                      pageSize: exportSettings.pageSize,
                      contactBox,
                    })
                  );
                  nextMap = { ...nextMap, '2x3': derived };
                }

                setCrops(nextMap);
                closeCropper();
              }}
            />
          ) : null}
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: Screen.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  imageCard: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageEmpty: {
    alignItems: 'center',
    gap: 4,
    padding: Spacing.four,
  },
  imageEmoji: {
    fontSize: 34,
    marginBottom: 4,
  },
  imageTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  imageHint: {
    fontSize: 13,
  },
  imageActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: -Spacing.one,
  },
  framingBlock: {
    gap: Spacing.two,
  },
  framingLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  framingHint: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: -Spacing.one,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  sizeHint: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: -Spacing.two,
  },
  dualPreview: {
    flexDirection: 'row',
    gap: Spacing.three,
    justifyContent: 'space-around',
  },
  dualCard: {
    alignItems: 'center',
    gap: 4,
    padding: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 100,
  },
  dualLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  dualHint: {
    fontSize: 11,
  },
  cropActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  cropActionBtn: {
    flex: 1,
  },
  notice: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: -Spacing.two,
  },
  error: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  submit: {
    marginTop: Spacing.one,
  },
});
