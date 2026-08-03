import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CroppedImage } from '@/components/cropped-image';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NormalizedRect, PixelRect } from '@/lib/crop-geometry';
import type { Rotation } from '@/types/models';

export type CellMm = { widthMm: number; heightMm: number };

type Resolution = { ratio: number; ok: boolean; ideal: { width: number; height: number } };

type Props = {
  uri: string | null;
  crop: NormalizedRect | null;
  sourceSize: { width: number; height: number } | null;
  rotation?: Rotation;
  /** Shape of one page cell (W/H). */
  cellAspect: number;
  /** Grid columns for the page mockup (default 2). */
  columns?: number;
  /** Grid rows for the page mockup (default 2). */
  rows?: number;
  /** Display name, e.g. "2 × 2". */
  layoutName?: string;
  cropPixels?: PixelRect | null;
  perfectSize: { width: number; height: number; minWidth: number; minHeight: number };
  /** Printed cell size in millimetres, when known. */
  cellMm?: CellMm | null;
  resolution?: Resolution | null;
  expanded: boolean;
  onToggle: () => void;
};

/**
 * What this pack shot will look like on the page.
 *
 * Small by default and openable full screen — the expanded view shows the cell
 * at a useful size next to a mock of the full page grid.
 */
export function CellPreview({
  uri,
  crop,
  sourceSize,
  rotation = 0,
  cellAspect,
  columns = 2,
  rows = 2,
  layoutName = '2 × 2',
  cropPixels,
  perfectSize,
  cellMm,
  resolution,
  expanded,
  onToggle,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const tooSmall = resolution ? !resolution.ok : false;
  const sizeLine = cropPixels
    ? `${cropPixels.width} × ${cropPixels.height} px`
    : 'Measuring…';

  const perPage = Math.max(1, columns * rows);
  const cellWPct = `${100 / Math.max(1, columns)}%` as const;
  const cellHPct = `${100 / Math.max(1, rows)}%` as const;

  // Thumbnail sized to the cell's real shape.
  const thumbH = 96;
  const thumbW = thumbH * cellAspect;

  // Expanded: one cell as large as the screen sensibly allows.
  const bigMax = Math.min(winW - Spacing.three * 2, 460);
  const bigH = Math.min(winH * 0.42, bigMax / cellAspect);
  const bigW = bigH * cellAspect;

  // Page mock keeps paper proportions (A4-ish) so denser grids still read.
  const pageH = bigW * 1.414;

  const cell = (w: number, h: number) => (
    <View
      style={[
        styles.cell,
        { width: w, height: h, borderColor: theme.border, backgroundColor: '#FFFFFF' },
      ]}>
      <CroppedImage
        uri={uri}
        crop={crop}
        sourceSize={sourceSize}
        rotation={rotation}
        style={StyleSheet.absoluteFill}
        transition={0}
      />
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <ThemedText style={styles.label}>On the page</ThemedText>
        <Pressable accessibilityRole="button" onPress={onToggle} hitSlop={10}>
          <ThemedText style={[styles.open, { color: theme.primary }]}>
            {expanded ? 'Close' : 'Open preview'}
          </ThemedText>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open a larger preview"
        onPress={onToggle}
        style={styles.row}>
        {cell(thumbW, thumbH)}
        <View style={styles.meta}>
          <ThemedText style={styles.metaTitle}>One cell of the {layoutName} page</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.metaLine}>
            Saving {sizeLine}
          </ThemedText>
          <ThemedText
            themeColor={tooSmall ? undefined : 'textSecondary'}
            style={[styles.metaLine, tooSmall && { color: theme.danger, fontWeight: '600' }]}>
            {tooSmall
              ? `Below the ${perfectSize.minWidth} × ${perfectSize.minHeight} px minimum — this will print soft.`
              : `Perfect size ${perfectSize.width} × ${perfectSize.height} px`}
          </ThemedText>
          {cellMm ? (
            <ThemedText themeColor="textSecondary" style={styles.metaLine}>
              Cell ~{cellMm.widthMm} × {cellMm.heightMm} mm on paper
            </ThemedText>
          ) : null}
        </View>
      </Pressable>

      <Modal
        visible={expanded}
        animationType="slide"
        transparent={false}
        onRequestClose={onToggle}>
        <View
          style={[
            styles.modal,
            { backgroundColor: theme.background, paddingTop: insets.top },
          ]}>
          <View style={[styles.modalHead, { borderBottomColor: theme.border }]}>
            <ThemedText style={styles.modalTitle}>How it will print</ThemedText>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <ThemedText themeColor="textSecondary" style={styles.modalHint}>
              This is one cell of the {layoutName} grid at print proportions. Export uses the crop
              you saved for this layout.
            </ThemedText>

            {cell(bigW, bigH)}

            <View
              style={[
                styles.factRow,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}>
              <Fact label="Crop size" value={sizeLine} />
              <Fact
                label="Perfect size"
                value={`${perfectSize.width} × ${perfectSize.height} px`}
              />
              <Fact
                label="Print quality"
                value={
                  !resolution
                    ? '—'
                    : resolution.ok
                      ? `Sharp (${Math.round(Math.min(resolution.ratio, 4) * 100)}%)`
                      : 'Too small'
                }
                danger={tooSmall}
              />
            </View>

            <ThemedText themeColor="textSecondary" style={styles.modalHint}>
              A photo smaller than the cell is enlarged to fill it, so aim for the perfect size
              or bigger when shooting a range.
            </ThemedText>

            <ThemedText style={styles.pageLabel}>The whole {layoutName} page</ThemedText>
            <View
              style={[styles.page, { borderColor: theme.border, width: bigW, height: pageH }]}>
              <View style={styles.pageGrid}>
                {Array.from({ length: perPage }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.pageCell,
                      {
                        borderColor: theme.border,
                        width: cellWPct,
                        height: cellHPct,
                      },
                    ]}>
                    <CroppedImage
                      uri={uri}
                      crop={crop}
                      sourceSize={sourceSize}
                      rotation={rotation}
                      style={StyleSheet.absoluteFill}
                      transition={0}
                    />
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View
            style={[
              styles.modalFoot,
              {
                borderTopColor: theme.border,
                paddingBottom: Math.max(insets.bottom, Spacing.three),
              },
            ]}>
            <Button title="Back to cropping" variant="primary" onPress={onToggle} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Fact({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.fact}>
      <ThemedText themeColor="textSecondary" style={styles.factLabel}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.factValue, danger && { color: theme.danger }]}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  open: { fontSize: 13.5, fontWeight: '700' },
  row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  cell: { borderRadius: Radii.sm, borderWidth: 1, overflow: 'hidden' },
  meta: { flex: 1, gap: 3 },
  metaTitle: { fontSize: 14, fontWeight: '600' },
  metaLine: { fontSize: 12, lineHeight: 17 },

  modal: { flex: 1 },
  modalHead: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalBody: {
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    alignItems: 'center',
  },
  modalHint: { alignSelf: 'stretch', fontSize: 13, lineHeight: 19 },
  factRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  fact: { flex: 1, gap: 2 },
  factLabel: { fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase' },
  factValue: { fontSize: 13.5, fontWeight: '700' },
  pageLabel: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  page: { borderWidth: 1, borderRadius: Radii.sm, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  pageGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  pageCell: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  modalFoot: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
