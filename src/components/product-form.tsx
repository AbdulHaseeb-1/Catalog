import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import type { NormalizedRect } from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { pluralize } from '@/lib/text';
import {
  normalizeImportedImage,
  pickImage,
  resolveImageUri,
  takePhoto,
} from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';
import { hasContactDetails, type Rotation } from '@/types/models';

export type ProductFormValues = {
  companyId: string;
  formulaId: string;
  /** Set only when the user picked a new image. */
  sourceUri?: string;
  /**
   * Framing for the image, as fractions of it. `undefined` leaves an existing
   * crop untouched; `null` means the full frame.
   */
  crop?: NormalizedRect | null;
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
  initialCrop?: NormalizedRect | null;
  /** Pixel size of the stored image, needed to place `initialCrop`. */
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
 * The whole product form: a company, a formula, and an image. Nothing else is
 * asked for — everything the PDF needs comes from those three.
 */
export function ProductForm({
  mode,
  initialCompanyId,
  initialFormulaId,
  initialImageUri,
  initialCrop,
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
  const [crop, setCrop] = useState<NormalizedRect | null | undefined>(undefined);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(
    initialImageSize ?? null
  );
  const [rotation, setRotation] = useState<Rotation | undefined>(undefined);
  const [cropping, setCropping] = useState(false);
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
  /** `undefined` means "unchanged", which for the preview reads as the original. */
  const activeCrop = crop === undefined ? (initialCrop ?? null) : crop;
  const activeRotation = rotation === undefined ? initialRotation : rotation;

  // The previews and the cropper measure against the layout this catalogue
  // will actually be exported with.
  const pageContext = {
    layoutId: exportSettings.layoutId,
    pageSize: exportSettings.pageSize,
    contactBox: exportSettings.includeContactBox && hasContactDetails(brandContact),
  };

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
   * Pick or shoot, then frame it straight away. Cropping at import is the only
   * point where the user still has the pack in front of them, and it means no
   * product ever enters the catalogue framed by accident.
   */
  const choose = async (source: 'library' | 'camera') => {
    setError(null);
    try {
      const picked = source === 'camera' ? await takePhoto() : await pickImage();
      if (!picked) return;

      setPreparing(true);
      // Re-encode before anything measures it. Camera files carry an EXIF
      // orientation flag that <Image> honours but the manipulator does not, so
      // an un-normalised portrait photo would be cropped a quarter turn out.
      const normalized = await normalizeImportedImage(picked);

      setSourceUri(normalized.uri);
      setImageSize({ width: normalized.width, height: normalized.height });
      // A fresh photo has no framing yet, and the old one described a
      // different picture.
      setCrop(null);
      setRotation(0);
      setCropping(true);
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
        crop,
        sourceSize: imageSize,
        rotation,
      });
    } catch (e) {
      setError(toMessage(e, 'Could not save this product.'));
    } finally {
      setSaving(false);
    }
  };

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
          <Button
            title={activeCrop ? 'Adjust crop' : 'Crop image'}
            variant="ghost"
            onPress={() => setCropping(true)}
            style={styles.cropButton}
          />
        ) : null}

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

      {/* Its own gesture root: pan and pinch do not reach a RN Modal from the
          root view underneath it. */}
      <Modal
        visible={cropping && !!previewUri}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCropping(false)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {/* Mounted only while open, so every visit starts from the crop the
              product currently has rather than from the last session's state. */}
          {cropping && previewUri ? (
            <ImageCropper
              uri={previewUri}
              initialCrop={activeCrop}
              initialRotation={activeRotation}
              page={pageContext}
              title={activeCrop ? 'Adjust crop' : 'Crop image'}
              subtitle="Framed once, re-derived for whichever grid you export"
              confirmLabel="Use this crop"
              onCancel={() => setCropping(false)}
              onConfirm={({ crop: next, sourceSize, rotation: nextRotation }) => {
                setCrop(next);
                setImageSize(sourceSize);
                setRotation(nextRotation);
                setCropping(false);
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
  cropButton: {
    marginTop: -Spacing.two,
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
