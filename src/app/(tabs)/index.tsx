import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductTile } from '@/components/product-tile';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { FabLayout, Screen, TabBar } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { matchesQuery, pluralize } from '@/lib/text';
import { useLibraryStore } from '@/stores/library-store';

const ALL = 'all';

export default function ProductsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const products = useLibraryStore((s) => s.products);
  const companies = useLibraryStore((s) => s.companies);
  const status = useLibraryStore((s) => s.status);
  const refresh = useLibraryStore((s) => s.refresh);
  const removeProduct = useLibraryStore((s) => s.removeProduct);

  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState<string>(ALL);
  const [refreshing, setRefreshing] = useState(false);

  const columns = width >= 700 ? 4 : width >= 480 ? 3 : 2;
  const contentWidth = Math.min(width, Screen.maxWidth);
  const gap = Screen.listGap;
  const padX = Screen.padX;
  const tileWidth = (contentWidth - padX * 2 - gap * (columns - 1)) / columns;

  const visible = useMemo(() => {
    return products.filter((product) => {
      if (companyId !== ALL && product.companyId !== companyId) return false;
      if (!query.trim()) return true;
      return (
        matchesQuery(product.formulaName, query) || matchesQuery(product.companyName, query)
      );
    });
  }, [products, companyId, query]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const openActions = (id: string, title: string) => {
    Alert.alert(title, undefined, [
      { text: 'Edit', onPress: () => router.push(`/product/${id}`) },
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
              await removeProduct(id);
            } catch (e) {
              Alert.alert(
                'Could not delete',
                e instanceof Error ? e.message : 'Unknown error'
              );
            }
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const listBottomPad = TabBar.contentInset + FabLayout.listClearance;
  const hasProducts = products.length > 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.container}>
        <View style={{ paddingHorizontal: padX }}>
          <ScreenHeader
            kicker="Eagle Pharma"
            title="Products"
            subtitle={
              hasProducts
                ? `${pluralize(products.length, 'product')} · ${pluralize(
                    companies.length,
                    'company',
                    'companies'
                  )}`
                : 'Every product is a company, a formula, and a pack shot.'
            }
          />
        </View>

        {hasProducts ? (
          <>
            <View style={{ paddingHorizontal: padX }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search formula or company"
                placeholderTextColor={theme.textSecondary}
                autoCorrect={false}
                style={[
                  styles.search,
                  {
                    color: theme.text,
                    backgroundColor: theme.bubble,
                    borderColor: theme.border,
                  },
                ]}
              />
            </View>

            {companies.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.filters, { paddingHorizontal: padX }]}>
                <Chip
                  label="All companies"
                  selected={companyId === ALL}
                  onPress={() => setCompanyId(ALL)}
                />
                {companies
                  .filter((company) => company.productCount > 0)
                  .map((company) => (
                    <Chip
                      key={company.id}
                      label={company.name}
                      selected={companyId === company.id}
                      onPress={() => setCompanyId(company.id)}
                    />
                  ))}
              </ScrollView>
            ) : null}
          </>
        ) : null}

        {status === 'loading' && !hasProducts ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} size="large" />
          </View>
        ) : !hasProducts ? (
          <View style={{ paddingHorizontal: padX, flex: 1, justifyContent: 'center' }}>
            <EmptyState
              emoji="💊"
              title="No products yet"
              description="Add a product by picking its company, its formula, and a photo of the pack. You can create the company or formula right from the form."
              actionLabel="Add product"
              onAction={() => router.push('/product/new')}
            />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary" style={styles.noMatch}>
              Nothing matches this filter.
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={visible}
            key={columns}
            numColumns={columns}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={onRefresh}
            contentContainerStyle={{
              paddingHorizontal: padX,
              paddingTop: Spacing.two,
              paddingBottom: listBottomPad,
            }}
            columnWrapperStyle={columns > 1 ? { gap } : undefined}
            ItemSeparatorComponent={() => <View style={{ height: gap }} />}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width: tileWidth }}>
                <ProductTile
                  product={item}
                  onPress={() => router.push(`/product/${item.id}`)}
                  onLongPress={() =>
                    openActions(item.id, `${item.formulaName} · ${item.companyName}`)
                  }
                />
              </View>
            )}
          />
        )}
      </View>

      <View
        style={[styles.fabSlot, { right: FabLayout.right, bottom: FabLayout.aboveTabBar }]}
        pointerEvents="box-none">
        <Fab
          icon="＋"
          label="Product"
          onPress={() => router.push('/product/new')}
          accessibilityLabel="Add product"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: Screen.maxWidth,
    alignSelf: 'center',
  },
  search: {
    minHeight: 46,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  filters: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    // Without this the row stretches its children on the cross axis and they
    // collapse to zero height, hiding the chip labels.
    alignItems: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  noMatch: {
    fontSize: 15,
  },
  fabSlot: {
    position: 'absolute',
  },
});
