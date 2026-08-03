import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { ProductForm } from '@/components/product-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { reportError, toMessage } from '@/lib/errors';
import { useLibraryStore } from '@/stores/library-store';

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function EditProductScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string | string[] }>();
  const productId = param(params.productId);

  const product = useLibraryStore((s) => s.products.find((p) => p.id === productId));
  const editProduct = useLibraryStore((s) => s.editProduct);
  const removeProduct = useLibraryStore((s) => s.removeProduct);

  if (!productId || !product) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">This product is no longer available.</ThemedText>
      </View>
    );
  }

  const onDelete = async () => {
    const ok = await confirmAction(
      'Delete product?',
      'The product and its image are removed from this device.'
    );
    if (!ok) return;
    try {
      await removeProduct(productId);
      router.back();
    } catch (e) {
      reportError('library', e);
      Alert.alert('Could not delete', toMessage(e));
    }
  };

  return (
    <ProductForm
      mode="edit"
      productId={productId}
      initialCompanyId={product.companyId}
      initialFormulaId={product.formulaId}
      initialImageUri={product.imageUri}
      initialCrops={product.crops}
      initialImageSize={
        product.width && product.height
          ? { width: product.width, height: product.height }
          : null
      }
      initialRotation={product.rotation}
      submitLabel="Save changes"
      onSubmit={async ({ companyId, formulaId, sourceUri, crops, sourceSize, rotation }) => {
        await editProduct(productId, {
          companyId,
          formulaId,
          sourceUri,
          crops,
          sourceSize,
          rotation,
        });
        router.back();
      }}
      footer={
        <View style={styles.footer}>
          <Button title="Delete product" variant="danger" onPress={onDelete} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  footer: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
