import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCatalogStore } from '@/stores/catalog-store';
import { LAYOUTS, type LayoutId, type LayoutMeta } from '@/types/models';

export default function LayoutsScreen() {
  const params = useLocalSearchParams<{ catalogId?: string | string[] }>();
  const catalogId = Array.isArray(params.catalogId) ? params.catalogId[0] : params.catalogId;
  const theme = useTheme();
  const router = useRouter();
  const loadCatalog = useCatalogStore((s) => s.loadCatalog);
  const updateCatalog = useCatalogStore((s) => s.updateCatalog);
  const catalog = useCatalogStore((s) => s.activeCatalog);
  const [saving, setSaving] = useState<LayoutId | null>(null);

  useEffect(() => {
    if (catalogId) loadCatalog(catalogId);
  }, [catalogId, loadCatalog]);

  const select = async (id: LayoutId) => {
    if (!catalogId || saving) return;
    if (catalog?.layoutId === id) {
      router.back();
      return;
    }
    setSaving(id);
    try {
      await updateCatalog(catalogId, { layoutId: id });
      router.back();
    } finally {
      setSaving(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        {
          maxWidth: Screen.maxWidth,
          width: '100%',
          alignSelf: 'center',
          paddingHorizontal: Screen.padX,
          paddingTop: Screen.padTop,
          paddingBottom: Spacing.six,
        },
      ]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <ThemedText style={styles.heading}>Choose layout</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.intro}>
          All layouts use a normal A4 page. Tap a photo in the gallery to crop it to the cell aspect.
        </ThemedText>
      </View>

      <View style={styles.list}>
        {LAYOUTS.map((layout) => {
          const selected = catalog?.layoutId === layout.id;
          const isSaving = saving === layout.id;
          return (
            <Pressable
              key={layout.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={!!saving}
              onPress={() => select(layout.id)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: theme.surfaceElevated,
                  borderColor: selected ? theme.primary : theme.border,
                  borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  opacity: pressed || (saving && !isSaving) ? 0.88 : 1,
                },
              ]}>
              <View
                style={[
                  styles.previewPane,
                  {
                    backgroundColor: selected ? theme.primaryMuted : theme.bubble,
                    borderRightColor: theme.border,
                  },
                ]}>
                <PagePreview layout={layout} selected={selected} />
              </View>

              <View style={styles.meta}>
                <View style={styles.titleRow}>
                  <View style={styles.titleBlock}>
                    <ThemedText style={styles.name}>{layout.name}</ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.gridLabel}>
                      {layout.columns}×{layout.rows} grid
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: selected ? theme.primary : theme.border,
                        backgroundColor: selected ? theme.primary : 'transparent',
                      },
                    ]}>
                    {isSaving ? (
                      <ActivityIndicator size="small" color={theme.fabIcon} />
                    ) : selected ? (
                      <ThemedText style={[styles.radioCheck, { color: theme.fabIcon }]}>✓</ThemedText>
                    ) : null}
                  </View>
                </View>

                <ThemedText themeColor="textSecondary" style={styles.desc} numberOfLines={2}>
                  {layout.description}
                </ThemedText>

                <View style={styles.chips}>
                  <Chip label={`${layout.perPage} / page`} bg={theme.primaryMuted} color={theme.primary} />
                  <Chip label="A4" bg={theme.bubble} color={theme.textSecondary} />
                  <Chip label="Crop ready" bg={theme.bubble} color={theme.textSecondary} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <ThemedText themeColor="textSecondary" style={styles.footer}>
        You can change layout anytime before exporting.
      </ThemedText>
    </ScrollView>
  );
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <ThemedText style={[styles.chipText, { color }]}>{label}</ThemedText>
    </View>
  );
}

function PagePreview({ layout, selected }: { layout: LayoutMeta; selected: boolean }) {
  const theme = useTheme();
  const pageW = 72;
  const pageH = 96;
  const gap = 2;
  const cellW = (pageW - gap * (layout.columns - 1)) / layout.columns;
  const cellH = (pageH - gap * (layout.rows - 1)) / layout.rows;

  return (
    <View style={styles.pageWrap}>
      <View
        style={[
          styles.pageShadow,
          {
            width: pageW,
            height: pageH,
            backgroundColor: theme.white,
            borderColor: selected ? theme.primary : theme.border,
          },
        ]}>
        {Array.from({ length: layout.rows }).map((_, r) => (
          <View
            key={r}
            style={[styles.pageRow, { gap, marginBottom: r < layout.rows - 1 ? gap : 0 }]}>
            {Array.from({ length: layout.columns }).map((_, c) => {
              const i = r * layout.columns + c;
              const fill = selected
                ? i % 2 === 0
                  ? 'rgba(26,115,232,0.45)'
                  : 'rgba(26,115,232,0.25)'
                : i % 2 === 0
                  ? 'rgba(95,99,104,0.14)'
                  : 'rgba(95,99,104,0.08)';
              return (
                <View
                  key={c}
                  style={{
                    width: cellW,
                    height: cellH,
                    backgroundColor: fill,
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
      <ThemedText themeColor="textSecondary" style={styles.pageCaption}>
        A4
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Screen.sectionGap,
  },
  header: {
    gap: 8,
  },
  heading: {
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
  },
  list: {
    gap: Screen.listGap,
  },
  card: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
    flexDirection: 'row',
    minHeight: 132,
  },
  previewPane: {
    width: 112,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  pageWrap: {
    alignItems: 'center',
    gap: 8,
  },
  pageShadow: {
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pageRow: {
    flexDirection: 'row',
  },
  pageCaption: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  meta: {
    flex: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: 14,
    gap: 8,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  gridLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCheck: {
    fontSize: 13,
    fontWeight: '800',
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  footer: {
    fontSize: 12,
    textAlign: 'center',
  },
});
