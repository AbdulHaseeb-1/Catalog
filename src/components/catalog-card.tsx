import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDate } from '@/lib/format';
import { resolveImageUri } from '@/services/image-service';
import { layoutMeta, type CatalogListItem } from '@/types/models';

type Props = {
  catalog: CatalogListItem;
  onPress: () => void;
  onLongPress?: () => void;
};

export function CatalogCard({ catalog, onPress, onLongPress }: Props) {
  const theme = useTheme();
  const cover = resolveImageUri(catalog.coverUri);
  const layout = layoutMeta(catalog.layoutId);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open catalog ${catalog.title}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        Elevation.card,
        {
          backgroundColor: theme.surfaceElevated,
          borderColor: theme.border,
          opacity: pressed ? 0.94 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}>
      <View style={[styles.cover, { backgroundColor: theme.bubble }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={styles.placeholder}>
            <ThemedText style={{ fontSize: 36 }}>🖼️</ThemedText>
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: 'rgba(32,33,36,0.72)' }]}>
          <ThemedText style={styles.badgeText}>
            {catalog.photoCount} photo{catalog.photoCount === 1 ? '' : 's'}
          </ThemedText>
        </View>
      </View>
      <View style={styles.meta}>
        <ThemedText numberOfLines={1} style={styles.title}>
          {catalog.title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.sub} numberOfLines={1}>
          {layout.name} · {formatRelativeDate(catalog.updatedAt)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
  },
  cover: {
    height: 148,
    position: 'relative',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  meta: {
    padding: Spacing.three,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: 12,
  },
});
