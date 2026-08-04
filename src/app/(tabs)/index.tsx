import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
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
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { Sheet } from '@/components/ui/sheet';
import { FabLayout, Screen, TabBar } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { reportError, toMessage } from '@/lib/errors';
import { matchesQuery, pluralize } from '@/lib/text';
import { useLibraryStore } from '@/stores/library-store';
import type { ProductWithRefs } from '@/types/models';

const ALL = 'all';

/** How long the undo bar stays after a delete. */
const UNDO_WINDOW_MS = 7000;

export default function ProductsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const products = useLibraryStore((s) => s.products);
  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const status = useLibraryStore((s) => s.status);
  const storeError = useLibraryStore((s) => s.error);
  const refresh = useLibraryStore((s) => s.refresh);
  const clearError = useLibraryStore((s) => s.clearError);
  const removeProduct = useLibraryStore((s) => s.removeProduct);
  const undoRemoveProducts = useLibraryStore((s) => s.undoRemoveProducts);
  const applyFramingTo = useLibraryStore((s) => s.applyFramingTo);

  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState<string>(ALL);
  const [formulaId, setFormulaId] = useState<string>(ALL);
  const [refreshing, setRefreshing] = useState(false);
  /** Pending undo for the last delete — cleared on a timer. */
  const [undo, setUndo] = useState<{ ids: string[]; label: string } | null>(null);
  /** Product whose action sheet is open. */
  const [menu, setMenu] = useState<ProductWithRefs | null>(null);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const columns = width >= 700 ? 4 : width >= 480 ? 3 : 2;
  const contentWidth = Math.min(width, Screen.maxWidth);
  const gap = Screen.listGap;
  const padX = Screen.padX;
  const tileWidth = (contentWidth - padX * 2 - gap * (columns - 1)) / columns;

  const visible = useMemo(() => {
    return products.filter((product) => {
      if (companyId !== ALL && product.companyId !== companyId) return false;
      if (formulaId !== ALL && product.formulaId !== formulaId) return false;
      if (!query.trim()) return true;
      return (
        matchesQuery(product.formulaName, query) || matchesQuery(product.companyName, query)
      );
    });
  }, [products, companyId, formulaId, query]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    clearError();
    try {
      await refresh();
    } catch (e) {
      // refresh() already records the failure; this is belt and braces so a
      // pull-to-refresh can never end as an unhandled rejection.
      reportError('library', e);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, clearError]);

  /** Copy one product's framing onto the rest of its company's range. */
  const shareFraming = async (product: ProductWithRefs) => {
    const siblings = products.filter(
      (p) => p.companyId === product.companyId && p.id !== product.id
    );
    if (!siblings.length) {
      return Alert.alert('Nothing to apply to', 'This company has no other products yet.');
    }
    const ok = await confirmAction(
      `Use this framing for ${pluralize(siblings.length, 'product')}?`,
      'Pack shots taken on the same rig usually want the same crop. Nothing is re-cut — each product keeps its own photo and can be re-cropped later.'
    );
    if (!ok) return;
    try {
      await applyFramingTo(
        siblings.map((p) => p.id),
        { crops: product.crops, rotation: product.rotation }
      );
    } catch (e) {
      Alert.alert('Could not apply that framing', toMessage(e));
    }
  };

  /**
   * Android's Alert only renders three buttons (negative / neutral /
   * positive), so a four-item menu silently loses one. A sheet keeps every
   * action reachable on both platforms.
   */
  const openActions = (product: ProductWithRefs) => setMenu(product);

  const deleteProduct = async (product: ProductWithRefs) => {
    setMenu(null);
    try {
      await removeProduct(product.id);
      // Soft deleted, so undo is offered instead of a confirm up front.
      setUndo({ ids: [product.id], label: product.formulaName });
    } catch (e) {
      Alert.alert('Could not delete', toMessage(e));
    }
  };

  const runUndo = async () => {
    if (!undo) return;
    const target = undo;
    setUndo(null);
    try {
      await undoRemoveProducts(target.ids);
    } catch (e) {
      Alert.alert('Could not restore', toMessage(e));
    }
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

        {storeError ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
            onPress={clearError}
            style={{ paddingHorizontal: padX, paddingBottom: Spacing.two }}>
            <View
              style={[
                styles.banner,
                { backgroundColor: theme.bubble, borderColor: theme.danger },
              ]}>
              <ThemedText style={[styles.bannerText, { color: theme.danger }]}>
                {storeError}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bannerHint}>
                Tap to dismiss · pull down to reload
              </ThemedText>
            </View>
          </Pressable>
        ) : null}

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

            {formulas.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.filters, { paddingHorizontal: padX }]}>
                <Chip
                  label="All formulas"
                  selected={formulaId === ALL}
                  onPress={() => setFormulaId(ALL)}
                />
                {formulas
                  .filter((formula) => formula.productCount > 0)
                  .map((formula) => (
                    <Chip
                      key={formula.id}
                      label={formula.name}
                      selected={formulaId === formula.id}
                      onPress={() => setFormulaId(formula.id)}
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
                  onLongPress={() => openActions(item)}
                />
              </View>
            )}
          />
        )}
      </View>

      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.formulaName ?? ''}>
        <View style={styles.menu}>
          <ThemedText themeColor="textSecondary" style={styles.menuSub}>
            {menu?.companyName}
          </ThemedText>
          <Button
            title="Edit product"
            variant="secondary"
            onPress={() => {
              const id = menu?.id;
              setMenu(null);
              if (id) router.push(`/product/${id}`);
            }}
          />
          <Button
            title="Use this framing for the company"
            variant="ghost"
            onPress={() => {
              const target = menu;
              setMenu(null);
              if (target) void shareFraming(target);
            }}
          />
          <Button
            title="Delete product"
            variant="danger"
            onPress={() => menu && void deleteProduct(menu)}
          />
        </View>
      </Sheet>

      {undo ? (
        <Pressable
          accessibilityRole="button"
          onPress={runUndo}
          style={[
            styles.undo,
            {
              bottom: TabBar.contentInset,
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}>
          <ThemedText style={styles.undoText} numberOfLines={1}>
            {undo.label} deleted
          </ThemedText>
          <ThemedText style={[styles.undoAction, { color: theme.primary }]}>UNDO</ThemedText>
        </Pressable>
      ) : null}

      <View
        style={[styles.fabSlot, { right: FabLayout.right, bottom: FabLayout.aboveTabBar }]}
        pointerEvents="box-none">
        <Fab
          icon="＋"
          label="Product"
          onPress={() => router.push('/product/new')}
          onLongPress={() => router.push('/product/bulk')}
          accessibilityLabel="Add product. Long press to import several photos at once."
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
  menu: { gap: Spacing.two, paddingBottom: Spacing.two },
  menuSub: { fontSize: 13, marginBottom: Spacing.one },
  undo: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  undoText: { flex: 1, fontSize: 13.5 },
  undoAction: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
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
  banner: {
    borderRadius: Radii.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: 2,
  },
  bannerText: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 19,
  },
  bannerHint: {
    fontSize: 12,
  },
  fabSlot: {
    position: 'absolute',
  },
});
