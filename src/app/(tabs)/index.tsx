import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CatalogCard } from '@/components/catalog-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { TextField } from '@/components/ui/text-field';
import { FabLayout, Screen, TabBar } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCatalogStore } from '@/stores/catalog-store';

export default function CatalogsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const catalogs = useCatalogStore((s) => s.catalogs);
  const status = useCatalogStore((s) => s.status);
  const createCatalog = useCatalogStore((s) => s.createCatalog);
  const deleteCatalog = useCatalogStore((s) => s.deleteCatalog);
  const refreshCatalogs = useCatalogStore((s) => s.refreshCatalogs);

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const columns = width >= 700 ? 3 : 2;
  const contentWidth = Math.min(width, Screen.maxWidth);
  const gap = Screen.listGap;
  const padX = Screen.padX;
  const cardWidth = (contentWidth - padX * 2 - gap * (columns - 1)) / columns;

  const listBottomPad = TabBar.contentInset + FabLayout.listClearance;

  const onCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Name required', 'Give your catalog a title.');
      return;
    }
    setCreating(true);
    try {
      const catalog = await createCatalog({ title: title.trim() });
      setModalOpen(false);
      setTitle('');
      router.push(`/catalog/${catalog.id}`);
    } catch (e) {
      Alert.alert('Could not create catalog', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCatalogs();
    } finally {
      setRefreshing(false);
    }
  }, [refreshCatalogs]);

  const openActions = (id: string, name: string) => {
    Alert.alert(name, undefined, [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Delete catalog?', 'All photos in this catalog will be removed.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteCatalog(id) },
          ]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.container, { maxWidth: Screen.maxWidth, width: '100%', alignSelf: 'center' }]}>
        <View style={[styles.header, { paddingHorizontal: padX }]}>
          <View style={styles.brandRow}>
            <View style={[styles.logoDot, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={{ fontSize: 18 }}>✦</ThemedText>
            </View>
            <View style={styles.brandText}>
              <ThemedText themeColor="textSecondary" style={styles.kicker}>
                Eagle Pharma
              </ThemedText>
              <ThemedText style={styles.heading}>Catalogs</ThemedText>
            </View>
          </View>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Build photo catalogs and export clean PDFs in seconds.
          </ThemedText>
        </View>

        {status === 'loading' && catalogs.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} size="large" />
          </View>
        ) : catalogs.length === 0 ? (
          <View style={{ paddingHorizontal: padX, flex: 1, justifyContent: 'center' }}>
            <EmptyState
              emoji="📷"
              title="No catalogs yet"
              description="Create a catalog, batch-upload photos, pick a layout, and export a polished PDF."
              actionLabel="New catalog"
              onAction={() => setModalOpen(true)}
            />
          </View>
        ) : (
          <FlatList
            data={catalogs}
            key={columns}
            numColumns={columns}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={onRefresh}
            contentContainerStyle={{
              paddingHorizontal: padX,
              paddingBottom: listBottomPad,
              gap: 0,
            }}
            columnWrapperStyle={columns > 1 ? { gap } : undefined}
            ItemSeparatorComponent={() => <View style={{ height: gap }} />}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width: cardWidth }}>
                <CatalogCard
                  catalog={item}
                  onPress={() => router.push(`/catalog/${item.id}`)}
                  onLongPress={() => openActions(item.id, item.title)}
                />
              </View>
            )}
          />
        )}
      </View>

      <View
        style={[styles.fabSlot, { right: FabLayout.right, bottom: FabLayout.aboveTabBar }]}
        pointerEvents="box-none">
        <Fab icon="＋" label="New" onPress={() => setModalOpen(true)} accessibilityLabel="Create catalog" />
      </View>

      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              Elevation.bar,
              {
                backgroundColor: theme.surfaceElevated,
                paddingBottom: Math.max(insets.bottom, 20) + 16,
              },
            ]}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
            <ThemedText style={styles.modalTitle}>New catalog</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.modalSubtitle}>
              Give it a name — add photos next.
            </ThemedText>
            <TextField
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="Spring collection"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setModalOpen(false)} style={{ flex: 1 }} />
              <Button title="Create" variant="primary" loading={creating} onPress={onCreate} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },
  header: {
    paddingTop: Screen.padTop,
    paddingBottom: Spacing.three,
    gap: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandText: {
    flex: 1,
    gap: 2,
  },
  logoDot: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  heading: {
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSlot: {
    position: 'absolute',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.two,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: -8,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: Spacing.one,
  },
});
