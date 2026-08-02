import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/constants/layout';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveImageUri } from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';
import type { ProductWithRefs } from '@/types/models';

const ROW_HEIGHT = 78;
const SPRING = { damping: 20, stiffness: 220, mass: 0.6 };

type Positions = Record<string, number>;

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/** ids in slot order, lowest slot first. */
function idsInOrder(positions: Positions): string[] {
  'worklet';
  return Object.keys(positions).sort((a, b) => positions[a] - positions[b]);
}

type RowProps = {
  product: ProductWithRefs;
  positions: SharedValue<Positions>;
  count: number;
  onDrop: (orderedIds: string[]) => void;
  /** Locks the surrounding scroll view while a row is in hand. */
  setDragging: (dragging: boolean) => void;
};

function Row({ product, positions, count, onDrop, setDragging }: RowProps) {
  const theme = useTheme();
  const uri = resolveImageUri(product.imageUri);

  const offset = useSharedValue((positions.value[product.id] ?? 0) * ROW_HEIGHT);
  const start = useSharedValue(0);
  const active = useSharedValue(false);

  // Follow the slot whenever another row displaces this one.
  useAnimatedReaction(
    () => positions.value[product.id],
    (slot, previous) => {
      if (slot !== undefined && slot !== previous && !active.value) {
        offset.value = withSpring(slot * ROW_HEIGHT, SPRING);
      }
    }
  );

  // Dragging is bound to the handle rather than the whole row: a vertical drag
  // anywhere on a row is ambiguous with scrolling the list, and the handle
  // makes the affordance obvious besides.
  const gesture = Gesture.Pan()
    .onStart(() => {
      active.value = true;
      start.value = offset.value;
      runOnJS(setDragging)(true);
    })
    .onUpdate((e) => {
      offset.value = start.value + e.translationY;

      const slot = clamp(Math.round(offset.value / ROW_HEIGHT), 0, count - 1);
      const current = positions.value[product.id];
      if (slot === current) return;

      // Swap with whoever holds the slot we moved into.
      const next: Positions = { ...positions.value };
      for (const id of Object.keys(next)) {
        if (next[id] === slot) {
          next[id] = current;
          break;
        }
      }
      next[product.id] = slot;
      positions.value = next;
    })
    .onEnd(() => {
      active.value = false;
      offset.value = withSpring(positions.value[product.id] * ROW_HEIGHT, SPRING);
      runOnJS(setDragging)(false);
      runOnJS(onDrop)(idsInOrder(positions.value));
    })
    .onFinalize(() => {
      if (active.value) {
        active.value = false;
        runOnJS(setDragging)(false);
      }
    });

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: ROW_HEIGHT,
    zIndex: active.value ? 2 : 1,
    transform: [{ translateY: offset.value }, { scale: withSpring(active.value ? 1.03 : 1, SPRING) }],
    shadowOpacity: withSpring(active.value ? 0.18 : 0, SPRING),
  }));

  return (
    <Animated.View style={style}>
      <View
        style={[
          styles.row,
          {
            backgroundColor: theme.surfaceElevated,
            borderColor: theme.border,
            shadowColor: '#000',
          },
        ]}>
        <View style={[styles.thumb, { backgroundColor: theme.bubble }]}>
          {uri ? <Image source={{ uri }} style={styles.image} contentFit="cover" /> : null}
        </View>
        <View style={styles.text}>
          <ThemedText style={styles.formula} numberOfLines={1}>
            {product.formulaName}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.hint} numberOfLines={1}>
            {product.companyName}
          </ThemedText>
        </View>

        <GestureDetector gesture={gesture}>
          <View
            accessibilityRole="adjustable"
            accessibilityLabel={`Drag to reorder ${product.formulaName}`}
            style={[styles.handle, { backgroundColor: theme.bubble }]}>
            <ThemedText style={[styles.handleGlyph, { color: theme.textSecondary }]}>≡</ThemedText>
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

export default function ReorderProductsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ companyId?: string | string[] }>();
  const companyId = param(params.companyId);

  const products = useLibraryStore((s) => s.products);
  const companies = useLibraryStore((s) => s.companies);
  const reorder = useLibraryStore((s) => s.reorderCompanyProducts);

  const company = companies.find((c) => c.id === companyId);

  /**
   * Snapshot the company's products once. The store re-sorts on every save, so
   * reading it live would reshuffle the list under the user's finger.
   */
  const initial = useMemo(
    () =>
      products
        .filter((p) => p.companyId === companyId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId]
  );

  const [items, setItems] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const positions = useSharedValue<Positions>(
    Object.fromEntries(initial.map((item, index) => [item.id, index]))
  );

  // Pick up products added or deleted elsewhere while this screen was open.
  useEffect(() => {
    const current = products.filter((p) => p.companyId === companyId);
    const known = new Set(items.map((i) => i.id));
    if (current.length === known.size && current.every((p) => known.has(p.id))) return;

    const next = current.sort((a, b) => a.sortOrder - b.sortOrder);
    setItems(next);
    positions.value = Object.fromEntries(next.map((item, index) => [item.id, index]));
  }, [products, companyId, items, positions]);

  const onDrop = useCallback(
    (orderedIds: string[]) => {
      if (!companyId) return;
      reorder(companyId, orderedIds)
        .then(() => {
          setSaved(true);
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaved(false), 1600);
        })
        .catch(() => undefined);
    },
    [companyId, reorder]
  );

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  if (!companyId || !company) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">This company is no longer in your list.</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <ThemedText style={styles.title}>{company.name}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.lede}>
            Drag the ≡ handle to move a product. This is the order its pack shots appear in the
            PDF — left to right, top to bottom across each page.
          </ThemedText>
        </View>

        <View style={{ height: items.length * ROW_HEIGHT }}>
          {items.map((item) => (
            <Row
              key={item.id}
              product={item}
              positions={positions}
              count={items.length}
              onDrop={onDrop}
              setDragging={setDragging}
            />
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.status,
          {
            borderTopColor: theme.border,
            backgroundColor: theme.background,
            paddingBottom: Math.max(insets.bottom, Spacing.two),
          },
        ]}>
        <ThemedText
          style={[styles.statusText, { color: saved ? theme.success : theme.textSecondary }]}>
          {saved ? '✓ Order saved' : 'Changes save as you drop'}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  content: {
    width: '100%',
    maxWidth: Screen.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: Screen.padX,
    paddingTop: Spacing.three,
  },
  intro: {
    gap: 6,
    paddingBottom: Spacing.three,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  lede: {
    fontSize: 14,
    lineHeight: 20,
  },
  row: {
    height: ROW_HEIGHT - 10,
    marginBottom: 10,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  thumb: {
    width: 50,
    height: 50,
    borderRadius: Radii.sm,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  text: { flex: 1, gap: 2 },
  formula: {
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
  },
  handle: {
    width: 52,
    alignSelf: 'stretch',
    marginVertical: 6,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGlyph: {
    fontSize: 20,
    fontWeight: '700',
  },
  status: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    paddingHorizontal: Screen.padX,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
