import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReferencePicker } from '@/components/reference-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pluralize } from '@/lib/text';
import { pickImage, resolveImageUri, takePhoto } from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';

export type ProductFormValues = {
  companyId: string;
  formulaId: string;
  /** Set only when the user picked a new image. */
  sourceUri?: string;
};

type Props = {
  mode: 'create' | 'edit';
  initialCompanyId?: string;
  initialFormulaId?: string;
  /** Stored image path, shown until the user picks a replacement. */
  initialImageUri?: string;
  /** Product being edited — excluded from the duplicate check. */
  productId?: string;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  /** Extra actions rendered under the primary button (crop, delete). */
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

  const [companyId, setCompanyId] = useState(initialCompanyId ?? '');
  const [formulaId, setFormulaId] = useState(initialFormulaId ?? '');
  const [sourceUri, setSourceUri] = useState<string | null>(null);
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

  const duplicate = useMemo(() => {
    if (!companyId || !formulaId) return false;
    return products.some(
      (product) =>
        product.companyId === companyId &&
        product.formulaId === formulaId &&
        product.id !== productId
    );
  }, [products, companyId, formulaId, productId]);

  const choose = async (source: 'library' | 'camera') => {
    setError(null);
    try {
      const uri = source === 'camera' ? await takePhoto() : await pickImage();
      if (uri) setSourceUri(uri);
    } catch (e) {
      Alert.alert(
        'Could not open the picker',
        e instanceof Error ? e.message : 'Unknown error'
      );
    }
  };

  const submit = async () => {
    if (!companyId) return setError('Select a company.');
    if (!formulaId) return setError('Select a formula.');
    if (!hasImage) return setError('Add a photo of the pack.');

    setSaving(true);
    setError(null);
    try {
      await onSubmit({ companyId, formulaId, sourceUri: sourceUri ?? undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this product.');
    } finally {
      setSaving(false);
    }
  };

  return (
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
          <Image source={{ uri: previewUri }} style={styles.image} contentFit="cover" />
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
          onPress={() => choose('library')}
          style={{ flex: 1 }}
        />
        <Button
          title="Camera"
          variant="ghost"
          onPress={() => choose('camera')}
          style={{ flex: 1 }}
        />
      </View>

      <ReferencePicker
        label="Company"
        placeholder="Select a company"
        options={companyOptions}
        value={companyId || undefined}
        onChange={(id) => {
          setCompanyId(id);
          setError(null);
        }}
        onCreate={async (name) => addCompany(name)}
        sheetTitle="Select company"
        sheetSubtitle="Search, or add one that is not on the list yet."
        noun="company"
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
