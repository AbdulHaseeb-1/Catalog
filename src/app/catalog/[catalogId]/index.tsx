import { Image } from 'expo-image';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { IconButton } from '@/components/ui/icon-button';
import { FabLayout, Screen } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { pickImages, resolveImageUri, takePhoto } from '@/services/image-service';
import { useCatalogStore } from '@/stores/catalog-store';
import { layoutMeta } from '@/types/models';

function useCatalogIdParam(): string | undefined {
  const params = useLocalSearchParams<{ catalogId?: string | string[] }>();
  return useMemo(() => {
    const raw = params.catalogId;
    if (Array.isArray(raw)) return raw[0];
    return raw;
  }, [params.catalogId]);
}

export default function CatalogPhotosScreen() {
  const catalogId = useCatalogIdParam();
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();

  const loadCatalog = useCatalogStore((s) => s.loadCatalog);
  const addPhotosFromUris = useCatalogStore((s) => s.addPhotosFromUris);
  const deletePhoto = useCatalogStore((s) => s.deletePhoto);
  const deletePhotos = useCatalogStore((s) => s.deletePhotos);
  const uploading = useCatalogStore((s) => s.uploading);
  const catalog = useCatalogStore((s) => s.activeCatalog);

  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    if (!catalogId) return;
    setLoading(true);
    try {
      await loadCatalog(catalogId);
    } finally {
      setLoading(false);
    }
  }, [catalogId, loadCatalog]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: catalog?.title ?? 'Photos',
      headerStyle: { backgroundColor: theme.background },
      headerShadowVisible: false,
      headerTintColor: theme.text,
    });
  }, [navigation, catalog?.title, theme.background, theme.text]);

  const columns = width >= 700 ? 4 : 3;
  const gap = Screen.listGap;
  const pad = Screen.padX;
  const cell = (width - pad * 2 - gap * (columns - 1)) / columns;
  const listBottom = FabLayout.stackBottom + FabLayout.listClearance;

  const exitSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const onBatchUpload = async () => {
    if (!catalogId) return;
    exitSelection();
    try {
      const uris = await pickImages();
      if (!uris.length) return;
      const count = await addPhotosFromUris(catalogId, uris);
      if (count === 0) {
        Alert.alert('Upload failed', 'Could not save any photos.');
      } else if (count < uris.length) {
        Alert.alert('Partially uploaded', `Saved ${count} of ${uris.length} photos.`);
      }
    } catch (e) {
      Alert.alert('Upload error', e instanceof Error ? e.message : 'Could not pick photos');
    }
  };

  const onCamera = async () => {
    if (!catalogId) return;
    exitSelection();
    try {
      const uri = await takePhoto();
      if (!uri) return;
      await addPhotosFromUris(catalogId, [uri]);
    } catch (e) {
      Alert.alert('Camera error', e instanceof Error ? e.message : 'Could not take photo');
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runDeleteOne = async (photoId: string) => {
    if (!catalogId) return;
    const ok = await confirmAction('Delete this photo?', 'Removed from catalog and PDF.');
    if (!ok) return;
    setDeleting(true);
    try {
      await deletePhoto(photoId, catalogId);
    } catch (e) {
      Alert.alert('Delete failed', e instanceof Error ? e.message : 'Could not delete');
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  const runDeleteSelected = async () => {
    if (!catalogId || !selected.size) return;
    const ok = await confirmAction(
      `Delete ${selected.size} photos?`,
      'Selected photos will be removed.'
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deletePhotos([...selected], catalogId);
      exitSelection();
    } catch (e) {
      Alert.alert('Delete failed', e instanceof Error ? e.message : 'Could not delete');
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  const layout = catalog ? layoutMeta(catalog.layoutId) : null;

  if (loading && !catalog) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (!catalogId || !catalog) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <EmptyState title="Catalog not found" description="It may have been deleted." actionLabel="Back" onAction={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* ChatGPT-style prompt chip bar */}
      <View style={styles.topBar}>
        <View style={[styles.chipBar, { backgroundColor: theme.bubble }]}>
          <ThemedText themeColor="textSecondary" style={styles.chipMeta} numberOfLines={1}>
            {catalog.photos.length} photos · {layout?.name ?? '2×2'}
          </ThemedText>
          <View style={styles.chipActions}>
            {catalog.photos.length > 0 ? (
              <Pressable
                onPress={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
                style={[styles.miniChip, { backgroundColor: theme.surfaceElevated }]}>
                <ThemedText style={styles.miniChipText}>
                  {selectionMode ? 'Done' : 'Select'}
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.push(`/catalog/${catalogId}/layouts`)}
              style={[styles.miniChip, { backgroundColor: theme.surfaceElevated }]}>
              <ThemedText style={styles.miniChipText}>Layout</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push(`/catalog/${catalogId}/preview`)}
              style={[styles.miniChip, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.miniChipText, { color: theme.primary }]}>Preview</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>

      {selectionMode ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.primaryMuted }]}>
          <ThemedText style={{ fontWeight: '600', flex: 1, color: theme.primary }}>
            {selected.size ? `${selected.size} selected` : 'Tap photos to select'}
          </ThemedText>
          <Button
            title="All"
            variant="ghost"
            onPress={() => setSelected(new Set(catalog.photos.map((p) => p.id)))}
          />
          <Button title="Delete" variant="danger" loading={deleting} onPress={runDeleteSelected} />
        </View>
      ) : null}

      {uploading || deleting ? (
        <View style={[styles.banner, { backgroundColor: theme.primaryMuted }]}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText style={{ marginLeft: 10, fontWeight: '600', color: theme.primary }}>
            {deleting ? 'Deleting…' : 'Uploading…'}
          </ThemedText>
        </View>
      ) : null}

      {catalog.photos.length === 0 ? (
        <EmptyState
          emoji="✨"
          title="Add photos"
          description="Batch upload from your library, crop to fit the grid, then export a PDF."
          actionLabel="Upload photos"
          onAction={onBatchUpload}
        />
      ) : (
        <FlatList
          data={catalog.photos}
          key={columns}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          extraData={{ selected, selectionMode, count: catalog.photos.length }}
          contentContainerStyle={{
            paddingHorizontal: pad,
            paddingTop: Spacing.two,
            paddingBottom: listBottom,
          }}
          columnWrapperStyle={{ gap }}
          ItemSeparatorComponent={() => <View style={{ height: gap }} />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const uri = resolveImageUri(item.uri);
            const isSelected = selected.has(item.id);
            return (
              <View style={{ width: cell, height: cell, position: 'relative' }}>
                <Pressable
                  onPress={() => {
                    if (selectionMode) toggle(item.id);
                    else router.push(`/catalog/${catalogId}/crop/${item.id}`);
                  }}
                  onLongPress={() => {
                    setSelectionMode(true);
                    toggle(item.id);
                  }}
                  style={[
                    styles.thumb,
                    Elevation.card,
                    {
                      borderColor: isSelected ? theme.primary : 'transparent',
                      borderWidth: isSelected ? 3 : 0,
                      backgroundColor: theme.bubble,
                    },
                  ]}>
                  {uri ? (
                    <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={styles.missing}>
                      <ThemedText themeColor="textSecondary">?</ThemedText>
                    </View>
                  )}
                  {selectionMode ? (
                    <View
                      style={[
                        styles.check,
                        { backgroundColor: isSelected ? theme.primary : 'rgba(0,0,0,0.35)' },
                      ]}>
                      {isSelected ? (
                        <ThemedText style={{ color: '#fff', fontWeight: '700' }}>✓</ThemedText>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>

                {!selectionMode ? (
                  <View style={styles.floatActions}>
                    <IconButton
                      icon="✂"
                      size={32}
                      variant="filled"
                      accessibilityLabel="Crop"
                      onPress={() => router.push(`/catalog/${catalogId}/crop/${item.id}`)}
                    />
                    <IconButton
                      icon="×"
                      size={32}
                      variant="filled"
                      accessibilityLabel="Delete"
                      disabled={deleting}
                      onPress={() => void runDeleteOne(item.id)}
                      style={{ backgroundColor: theme.danger }}
                    />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* Floating action cluster */}
      <View style={styles.fabCluster} pointerEvents="box-none">
        {selectionMode ? (
          <Fab
            icon="🗑"
            label={selected.size ? `Delete ${selected.size}` : 'Delete'}
            variant="danger"
            onPress={runDeleteSelected}
          />
        ) : (
          <>
            <Fab
              icon="↑"
              variant="secondary"
              onPress={() => router.push(`/catalog/${catalogId}/export`)}
              accessibilityLabel="Export PDF"
              style={styles.fabSecondary}
            />
            <Fab
              icon="📷"
              variant="secondary"
              onPress={onCamera}
              accessibilityLabel="Camera"
              style={styles.fabSecondary}
            />
            <Fab
              icon="＋"
              label="Photos"
              onPress={onBatchUpload}
              accessibilityLabel="Add photos"
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  chipBar: {
    borderRadius: Radii.xl,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  chipMeta: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  miniChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radii.pill,
  },
  miniChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Screen.padX,
    paddingVertical: 10,
    gap: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Screen.padX,
    paddingVertical: 10,
  },
  thumb: {
    flex: 1,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatActions: {
    position: 'absolute',
    top: 6,
    right: 6,
    left: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 4,
  },
  fabCluster: {
    position: 'absolute',
    right: FabLayout.right,
    bottom: FabLayout.stackBottom,
    flexDirection: 'row',
    alignItems: 'center',
    gap: FabLayout.gap,
  },
  fabSecondary: {
    ...Elevation.card,
  },
});
