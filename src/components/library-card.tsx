import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveImageUri } from '@/services/image-service';

type Props = {
  title: string;
  meta: string;
  coverUri: string | null;
  /** Shown in the thumbnail when the entry has no products yet. */
  fallbackIcon: string;
  onPress: () => void;
  onLongPress?: () => void;
};

/** One row in the Companies / Formulas lists. */
export function LibraryCard({
  title,
  meta,
  coverUri,
  fallbackIcon,
  onPress,
  onLongPress,
}: Props) {
  const theme = useTheme();
  const uri = resolveImageUri(coverUri);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        Elevation.card,
        {
          backgroundColor: theme.surfaceElevated,
          borderColor: theme.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}>
      <View style={[styles.thumb, { backgroundColor: theme.primaryMuted }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} contentFit="cover" transition={120} />
        ) : (
          <ThemedText style={styles.fallback}>{fallbackIcon}</ThemedText>
        )}
      </View>

      <View style={styles.text}>
        <ThemedText style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.meta} numberOfLines={1}>
          {meta}
        </ThemedText>
      </View>

      <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>›</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    paddingRight: Spacing.three,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: Radii.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    fontSize: 22,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: 13,
  },
  chevron: {
    fontSize: 22,
    fontWeight: '300',
  },
});
