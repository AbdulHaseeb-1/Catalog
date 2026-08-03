import { Pressable, StyleSheet, View } from 'react-native';

import { CroppedImage } from '@/components/cropped-image';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveImageUri } from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';
import { cropForLayout, hasCropForLayout, type ProductWithRefs } from '@/types/models';

type Props = {
  product: ProductWithRefs;
  onPress: () => void;
  onLongPress?: () => void;
  /** Dim + tick the tile while a multi-select is active. */
  selected?: boolean;
  /**
   * What the surrounding screen already tells the user. On a company page the
   * company name under every tile is noise; on a formula page the company is
   * the only thing that distinguishes one tile from the next.
   */
  context?: 'all' | 'company' | 'formula';
};

export function ProductTile({
  product,
  onPress,
  onLongPress,
  selected,
  context = 'all',
}: Props) {
  const theme = useTheme();
  const layoutId = useLibraryStore((s) => s.exportSettings.layoutId);
  const uri = resolveImageUri(product.imageUri);
  const crop = cropForLayout(product, layoutId);
  const framed = hasCropForLayout(product, layoutId);
  const primary = context === 'formula' ? product.companyName : product.formulaName;
  const secondary = context === 'all' ? product.companyName : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.formulaName}, ${product.companyName}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.88 : 1 }]}>
      <View
        style={[
          styles.frame,
          {
            backgroundColor: theme.bubble,
            borderColor: selected ? theme.primary : theme.border,
            borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          },
        ]}>
        {uri ? (
          // Square tile, so the crop is reshaped to 1:1 exactly as an export
          // cell would — the tile and the printed page agree.
          <CroppedImage
            uri={uri}
            crop={crop}
            sourceSize={
              product.width && product.height
                ? { width: product.width, height: product.height }
                : null
            }
            rotation={product.rotation}
            style={styles.image}
          />
        ) : (
          <View style={styles.placeholder}>
            <ThemedText themeColor="textSecondary" style={styles.placeholderIcon}>
              ▢
            </ThemedText>
          </View>
        )}
        {selected ? (
          <View style={[styles.tick, { backgroundColor: theme.primary }]}>
            <ThemedText style={[styles.tickMark, { color: theme.fabIcon }]}>✓</ThemedText>
          </View>
        ) : null}
        {!framed && uri ? (
          <View style={[styles.badge, { backgroundColor: theme.danger }]}>
            <ThemedText style={styles.badgeText}>Crop</ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.meta}>
        <ThemedText style={styles.formula} numberOfLines={1}>
          {primary}
        </ThemedText>
        {secondary ? (
          <ThemedText themeColor="textSecondary" style={styles.company} numberOfLines={1}>
            {secondary}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 26,
  },
  tick: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickMark: {
    fontSize: 13,
    fontWeight: '800',
  },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.sm,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  meta: {
    gap: 1,
    paddingHorizontal: 2,
  },
  formula: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  company: {
    fontSize: 12,
  },
});
