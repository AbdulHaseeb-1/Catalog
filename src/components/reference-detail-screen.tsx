import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Alert, FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ProductTile } from '@/components/product-tile';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { pluralize } from '@/lib/text';
import { useLibraryStore } from '@/stores/library-store';

type Kind = 'company' | 'formula';

/** Company and formula detail pages differ only in wording and grouping. */
export function ReferenceDetailScreen({ kind, id }: { kind: Kind; id: string | undefined }) {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();

  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const products = useLibraryStore((s) => s.products);
  const removeProduct = useLibraryStore((s) => s.removeProduct);

  const entry = useMemo(() => {
    if (!id) return undefined;
    if (kind === 'company') {
      const company = companies.find((c) => c.id === id);
      return company
        ? {
            name: company.name,
            meta: company.productCount
              ? `${pluralize(company.productCount, 'product')} · ${pluralize(
                  company.formulaCount,
                  'formula'
                )}`
              : 'No products yet',
          }
        : undefined;
    }
    const formula = formulas.find((f) => f.id === id);
    return formula
      ? {
          name: formula.name,
          meta: formula.productCount
            ? `${pluralize(formula.productCount, 'product')} · ${pluralize(
                formula.companyCount,
                'company',
                'companies'
              )}`
            : 'No products yet',
        }
      : undefined;
  }, [kind, id, companies, formulas]);

  const items = useMemo(
    () =>
      products.filter((product) =>
        kind === 'company' ? product.companyId === id : product.formulaId === id
      ),
    [products, kind, id]
  );

  useEffect(() => {
    if (entry) navigation.setOptions({ title: entry.name });
  }, [navigation, entry]);

  if (!id || !entry) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">
          This {kind} is no longer in your list.
        </ThemedText>
      </View>
    );
  }

  const columns = width >= 700 ? 4 : width >= 480 ? 3 : 2;
  const contentWidth = Math.min(width, Screen.maxWidth);
  const gap = Screen.listGap;
  const tileWidth = (contentWidth - Screen.padX * 2 - gap * (columns - 1)) / columns;

  const newProductParams = kind === 'company' ? { companyId: id } : { formulaId: id };

  const openActions = (productId: string, title: string) => {
    Alert.alert(title, undefined, [
      { text: 'Edit', onPress: () => router.push(`/product/${productId}`) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const ok = await confirmAction(
            'Delete product?',
            'The product and its image are removed from this device.'
          );
          if (ok) {
            try {
              await removeProduct(productId);
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Unknown error');
            }
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const header = (
    <View style={styles.header}>
      <View
        style={[
          styles.summary,
          { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
        ]}>
        <ThemedText themeColor="textSecondary" style={styles.kicker}>
          {kind === 'company' ? 'Company' : 'Formula'}
        </ThemedText>
        <ThemedText style={styles.name}>{entry.name}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.meta}>
          {entry.meta}
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <Button
          title="Generate PDF"
          variant="primary"
          disabled={!items.length}
          onPress={() =>
            router.push({ pathname: '/export/preview', params: { kind, id } })
          }
          style={{ flex: 1 }}
        />
        <Button
          title="Add product"
          variant="secondary"
          onPress={() => router.push({ pathname: '/product/new', params: newProductParams })}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.background }}
      data={items}
      key={columns}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentContainerStyle={{
        width: '100%',
        maxWidth: Screen.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: Screen.padX,
        paddingBottom: Spacing.six,
      }}
      columnWrapperStyle={columns > 1 ? { gap } : undefined}
      ItemSeparatorComponent={() => <View style={{ height: gap }} />}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <EmptyState
          emoji="📦"
          title="No products yet"
          description={
            kind === 'company'
              ? 'Add this company’s products to build its catalogue.'
              : 'Add products using this formula to compare brands side by side.'
          }
          actionLabel="Add product"
          onAction={() => router.push({ pathname: '/product/new', params: newProductParams })}
        />
      }
      renderItem={({ item }) => (
        <View style={{ width: tileWidth }}>
          <ProductTile
            product={item}
            onPress={() => router.push(`/product/${item.id}`)}
            onLongPress={() => openActions(item.id, `${item.formulaName} · ${item.companyName}`)}
          />
        </View>
      )}
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
  header: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  summary: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: 3,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  meta: {
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
