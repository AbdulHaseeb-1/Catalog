import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CellPreview } from '@/components/cell-preview';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PROBE_MAX_EDGE } from '@/lib/auto-trim';
import {
  rotateNormalized,
  toNormalized,
  toPixels,
  type NormalizedRect,
  type PixelRect,
  type Size,
} from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { renderRotatedCopy, toProbeDataUri } from '@/services/image-service';
import {
  asRotation,
  assessResolution,
  cellAspectRatio,
  recommendedSourcePixels,
  type PageContext,
  type Rotation,
} from '@/types/models';

import { AutoTrimProbe } from './auto-trim-probe';

const AnimatedImage = Animated.createAnimatedComponent(Image);

export type CropResult = {
  crop: NormalizedRect;
  /** Size of the upright master — what the product row stores. */
  sourceSize: Size;
  rotation: Rotation;
};

type Props = {
  /** Source image, already resolved to something the manipulator can open. */
  uri: string;
  /** Existing framing to reopen, in fractions of the rotated source. */
  initialCrop?: NormalizedRect | null;
  initialRotation?: Rotation;
  /** Export settings the frame is measured against. */
  page: PageContext;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: CropResult) => void | Promise<void>;
};

/**
 * Crop editor for one page-grid cell (2×2 or 2×3).
 *
 * The frame is locked to that cell’s aspect, so what sits inside it is precisely
 * what prints. Drag to move, pinch to zoom, rotate for the best angle; the
 * frame stays covered so a cell is never left empty.
 */
export function ImageCropper({
  uri,
  initialCrop,
  initialRotation = 0,
  page,
  title = 'Crop image',
  subtitle,
  confirmLabel = 'Apply crop',
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const [imgSize, setImgSize] = useState<Size | null>(null);
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  const [workingUri, setWorkingUri] = useState<string>(uri);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rotation, setRotation] = useState<Rotation>(initialRotation);
  const [rotating, setRotating] = useState(false);
  const [panning, setPanning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [probeUri, setProbeUri] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<NormalizedRect | null>(null);
  const [suggestionUsed, setSuggestionUsed] = useState(false);

  // JS mirror of the gesture transform, for the preview and for saving.
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [zoom, setZoom] = useState(1);

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pendingFrame = useRef<NormalizedRect | null>(null);
  const placed = useRef(false);
  const [boot] = useState(() => ({ initialCrop }));

  /** The one cell shape everything is measured against. */
  const cellAspect = useMemo(
    () =>
      cellAspectRatio({
        layoutId: page.layoutId,
        pageSize: page.pageSize,
        contactBox: page.contactBox,
      }),
    [page.layoutId, page.pageSize, page.contactBox]
  );

  const perfectSize = useMemo(
    () =>
      recommendedSourcePixels({
        layoutId: page.layoutId,
        pageSize: page.pageSize,
        contactBox: page.contactBox,
      }),
    [page.layoutId, page.pageSize, page.contactBox]
  );

  const editorW = Math.min(winW - Spacing.three * 2, 420);
  const editorH = Math.min(Math.max(winH * 0.38, 240), 380);

  /** Crop frame, drawn at the cell's exact proportions. */
  const frame = useMemo(() => {
    const pad = Spacing.three;
    const maxW = editorW - pad * 2;
    const maxH = editorH - pad * 2;
    let w: number;
    let h: number;
    if (maxW / maxH > cellAspect) {
      h = maxH;
      w = h * cellAspect;
    } else {
      w = maxW;
      h = w / cellAspect;
    }
    return { w, h, x: (editorW - w) / 2, y: (editorH - h) / 2 };
  }, [editorW, editorH, cellAspect]);

  const fitScale = useMemo(() => {
    if (!imgSize) return 1;
    return Math.min(editorW / imgSize.width, editorH / imgSize.height);
  }, [imgSize, editorW, editorH]);

  /**
   * Smallest zoom that still covers the frame. Enforcing it is what makes the
   * picture enlarge itself when it is too small for the cell, instead of
   * leaving a gap.
   */
  const minZoom = useMemo(() => {
    if (!imgSize) return 1;
    return Math.max(
      frame.w / (imgSize.width * fitScale),
      frame.h / (imgSize.height * fitScale),
      0.01
    );
  }, [imgSize, fitScale, frame]);

  /* ------------------------------------------------------------ transform io */

  const applyPixelRect = useCallback(
    (rect: PixelRect) => {
      if (!imgSize) return;
      const s = frame.w / Math.max(1, rect.width);
      const dispW = imgSize.width * s;
      const dispH = imgSize.height * s;
      const nextX = frame.x - rect.originX * s - (editorW / 2 - dispW / 2);
      const nextY = frame.y - rect.originY * s - (editorH / 2 - dispH / 2);
      const nextZoom = Math.max(s / fitScale, minZoom);

      scale.value = nextZoom;
      translateX.value = nextX;
      translateY.value = nextY;
      setZoom(nextZoom);
      setTx(nextX);
      setTy(nextY);
    },
    [imgSize, frame, editorW, editorH, fitScale, minZoom, scale, translateX, translateY]
  );

  /** Pixel rect currently under the frame. */
  const rectFromTransform = useCallback(
    (x: number, y: number, z: number): PixelRect | null => {
      if (!imgSize) return null;
      const s = fitScale * z;
      const dispW = imgSize.width * s;
      const dispH = imgSize.height * s;
      const imgLeft = editorW / 2 - dispW / 2 + x;
      const imgTop = editorH / 2 - dispH / 2 + y;

      // Size is clamped before the origin so the rect keeps the cell's shape.
      const width = Math.min(frame.w / s, imgSize.width);
      const height = Math.min(frame.h / s, imgSize.height);
      const originX = Math.min(Math.max((frame.x - imgLeft) / s, 0), imgSize.width - width);
      const originY = Math.min(Math.max((frame.y - imgTop) / s, 0), imgSize.height - height);

      return {
        originX: Math.round(originX),
        originY: Math.round(originY),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
    },
    [imgSize, fitScale, frame, editorW, editorH]
  );

  const cropRect = useMemo(
    () => rectFromTransform(tx, ty, zoom),
    [rectFromTransform, tx, ty, zoom]
  );

  const currentCrop = useMemo(
    () => (imgSize && cropRect ? toNormalized(cropRect, imgSize) : null),
    [imgSize, cropRect]
  );

  const resolution = useMemo(
    () =>
      cropRect
        ? assessResolution(cropRect, {
            layoutId: page.layoutId,
            pageSize: page.pageSize,
            contactBox: page.contactBox,
          })
        : null,
    [cropRect, page.layoutId, page.pageSize, page.contactBox]
  );

  /* ----------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const rendered = await renderRotatedCopy(uri, rotation);
        if (cancelled) return;

        setWorkingUri(rendered.uri);
        setImgSize({ width: rendered.width, height: rendered.height });
        // The row stores the upright master's size; the crop is expressed
        // against the rotated frame. Keeping the two apart is what stops a
        // quarter-turned photo having its dimensions transposed twice.
        setBaseSize({ width: rendered.baseWidth, height: rendered.baseHeight });

        if (!placed.current) {
          placed.current = true;
          pendingFrame.current = boot.initialCrop ?? null;
        }

        void toProbeDataUri(rendered.uri, { maxEdge: PROBE_MAX_EDGE }).then((probe) => {
          if (!cancelled) setProbeUri(probe);
        });
      } catch (e) {
        reportError('image', e);
        if (!cancelled) setLoadError(toMessage(e, 'Could not read this image.'));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRotating(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, rotation, boot]);

  /** Place the framing once the image is measured. */
  useEffect(() => {
    if (!imgSize) return;
    const frameRect = pendingFrame.current;
    pendingFrame.current = null;
    if (frameRect) {
      applyPixelRect(toPixels(frameRect, imgSize));
    } else if (!placedOnce.current) {
      placedOnce.current = true;
      // No crop yet: start covering the frame from the centre.
      scale.value = minZoom;
      translateX.value = 0;
      translateY.value = 0;
      setZoom(minZoom);
      setTx(0);
      setTy(0);
    }
  }, [imgSize, minZoom, applyPixelRect, scale, translateX, translateY]);

  const placedOnce = useRef(false);

  /* ---------------------------------------------------------------- gestures */

  const syncTransform = (x: number, y: number, z: number) => {
    setTx(x);
    setTy(y);
    setZoom(z);
  };
  const setPanningJS = (value: boolean) => setPanning(value);

  const gesture = useMemo(() => {
    const width = imgSize?.width ?? 0;
    const height = imgSize?.height ?? 0;

    /** Keep the frame covered — this is the "never leave a gap" rule. */
    const clampTranslation = (x: number, y: number, z: number) => {
      'worklet';
      if (!width || !height) return { x, y };
      const s = fitScale * z;
      const dispW = width * s;
      const dispH = height * s;
      const maxX = frame.x - editorW / 2 + dispW / 2;
      const minX = frame.x + frame.w - editorW / 2 - dispW / 2;
      const maxY = frame.y - editorH / 2 + dispH / 2;
      const minY = frame.y + frame.h - editorH / 2 - dispH / 2;
      return {
        x: Math.min(Math.max(x, Math.min(minX, maxX)), Math.max(minX, maxX)),
        y: Math.min(Math.max(y, Math.min(minY, maxY)), Math.max(minY, maxY)),
      };
    };

    const pan = Gesture.Pan()
      .onBegin(() => {
        startX.value = translateX.value;
        startY.value = translateY.value;
        runOnJS(setPanningJS)(true);
      })
      .onUpdate((e) => {
        const next = clampTranslation(
          startX.value + e.translationX,
          startY.value + e.translationY,
          scale.value
        );
        translateX.value = next.x;
        translateY.value = next.y;
      })
      .onFinalize(() => {
        runOnJS(setPanningJS)(false);
        runOnJS(syncTransform)(translateX.value, translateY.value, scale.value);
      });

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        startScale.value = scale.value;
        runOnJS(setPanningJS)(true);
      })
      .onUpdate((e) => {
        // Never below minZoom, so zooming out cannot uncover the frame.
        const next = Math.min(8, Math.max(minZoom, startScale.value * e.scale));
        scale.value = next;
        const clamped = clampTranslation(translateX.value, translateY.value, next);
        translateX.value = clamped.x;
        translateY.value = clamped.y;
      })
      .onFinalize(() => {
        runOnJS(setPanningJS)(false);
        runOnJS(syncTransform)(translateX.value, translateY.value, scale.value);
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [
    imgSize,
    fitScale,
    frame,
    editorW,
    editorH,
    minZoom,
    scale,
    startScale,
    translateX,
    translateY,
    startX,
    startY,
  ]);

  const imageStyle = useAnimatedStyle(() => {
    if (!imgSize) return {};
    const s = fitScale * scale.value;
    const w = imgSize.width * s;
    const h = imgSize.height * s;
    return {
      width: w,
      height: h,
      position: 'absolute' as const,
      left: editorW / 2 - w / 2 + translateX.value,
      top: editorH / 2 - h / 2 + translateY.value,
    };
  }, [imgSize, fitScale, editorW, editorH]);

  /* -------------------------------------------------------------- operations */

  const reset = () => {
    if (!imgSize) return;
    scale.value = minZoom;
    translateX.value = 0;
    translateY.value = 0;
    setZoom(minZoom);
    setTx(0);
    setTy(0);
  };

  const rotateBy = (quarterTurns: number) => {
    if (!imgSize || rotating || !currentCrop) return;
    pendingFrame.current = rotateNormalized(currentCrop, quarterTurns);
    setRotating(true);
    setRotation(asRotation(rotation + quarterTurns * 90));
  };

  const applySuggestion = () => {
    if (!suggestion || !imgSize) return;
    applyPixelRect(toPixels(suggestion, imgSize));
    setSuggestionUsed(true);
  };

  const apply = async () => {
    if (!imgSize || !baseSize) return;
    // Read the live shared values — the JS mirror can lag a gesture.
    const rect = rectFromTransform(translateX.value, translateY.value, scale.value);
    if (!rect) return;
    await onConfirm({
      crop: toNormalized(rect, imgSize),
      sourceSize: baseSize,
      rotation,
    });
  };

  const disabled = loading || rotating || !imgSize || !cropRect;
  const offerSuggestion = !!suggestion && !suggestionUsed && !disabled;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <AutoTrimProbe
        dataUri={probeUri}
        onResult={(rect) => {
          setProbeUri(null);
          setSuggestion(rect);
        }}
      />

      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerText}>
          <ThemedText style={styles.headerTitle}>{title}</ThemedText>
          {subtitle ? (
            <ThemedText themeColor="textSecondary" style={styles.headerSub} numberOfLines={1}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={reset}
          disabled={disabled}
          hitSlop={10}
          style={({ pressed }) => [
            styles.resetBtn,
            { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
          ]}>
          <ThemedText style={[styles.resetText, { color: theme.primary }]}>Reset</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        scrollEnabled={!panning}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          Drag to move, pinch to zoom, use Rotate for the best angle. The frame is one cell
          of this page grid — whatever sits inside it is exactly what prints.
        </ThemedText>

        <View style={[styles.editor, { width: editorW, height: editorH }]}>
          {loading ? (
            <ActivityIndicator color={theme.accent} style={styles.editorSpinner} />
          ) : !imgSize ? (
            <View style={styles.editorError}>
              <ThemedText style={styles.editorErrorText}>
                {loadError ?? 'This image could not be opened for cropping.'}
              </ThemedText>
            </View>
          ) : (
            <GestureDetector gesture={gesture}>
              <View style={{ width: editorW, height: editorH, overflow: 'hidden' }}>
                <AnimatedImage source={{ uri: workingUri }} style={imageStyle} contentFit="fill" />

                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={[styles.dim, { left: 0, right: 0, top: 0, height: frame.y }]} />
                  <View
                    style={[styles.dim, { left: 0, right: 0, top: frame.y + frame.h, bottom: 0 }]}
                  />
                  <View
                    style={[styles.dim, { left: 0, top: frame.y, width: frame.x, height: frame.h }]}
                  />
                  <View
                    style={[
                      styles.dim,
                      { right: 0, top: frame.y, width: frame.x, height: frame.h },
                    ]}
                  />

                  <View
                    style={{
                      position: 'absolute',
                      left: frame.x,
                      top: frame.y,
                      width: frame.w,
                      height: frame.h,
                      borderWidth: 2,
                      borderColor: theme.accent,
                    }}>
                    <View style={[styles.gridLineH, { top: '33.33%' }]} />
                    <View style={[styles.gridLineH, { top: '66.66%' }]} />
                    <View style={[styles.gridLineV, { left: '33.33%' }]} />
                    <View style={[styles.gridLineV, { left: '66.66%' }]} />
                    <View style={[styles.corner, styles.tl, { borderColor: theme.accent }]} />
                    <View style={[styles.corner, styles.tr, { borderColor: theme.accent }]} />
                    <View style={[styles.corner, styles.bl, { borderColor: theme.accent }]} />
                    <View style={[styles.corner, styles.br, { borderColor: theme.accent }]} />
                  </View>
                </View>
              </View>
            </GestureDetector>
          )}
        </View>

        <View style={styles.toolRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rotate left"
            onPress={() => rotateBy(-1)}
            disabled={disabled}
            style={[styles.tool, { borderColor: theme.border, opacity: disabled ? 0.4 : 1 }]}>
            <ThemedText style={styles.toolIcon}>↺</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rotate right"
            onPress={() => rotateBy(1)}
            disabled={disabled}
            style={[styles.tool, { borderColor: theme.border, opacity: disabled ? 0.4 : 1 }]}>
            <ThemedText style={styles.toolIcon}>↻</ThemedText>
          </Pressable>

          {offerSuggestion ? (
            <Pressable
              accessibilityRole="button"
              onPress={applySuggestion}
              style={[
                styles.tool,
                styles.toolWide,
                { borderColor: theme.primary, backgroundColor: theme.primaryMuted },
              ]}>
              <ThemedText style={[styles.toolLabel, { color: theme.primary }]}>
                Snap to pack
              </ThemedText>
            </Pressable>
          ) : (
            <View style={styles.toolFill}>
              <ThemedText themeColor="textSecondary" style={styles.toolHint}>
                {rotation ? `Rotated ${rotation}°` : 'Upright'}
              </ThemedText>
            </View>
          )}
        </View>

        <CellPreview
          uri={workingUri}
          crop={currentCrop}
          sourceSize={imgSize}
          cellAspect={cellAspect}
          cropPixels={cropRect}
          perfectSize={perfectSize}
          resolution={resolution}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.border,
            backgroundColor: theme.background,
            paddingBottom: Math.max(insets.bottom, Spacing.three),
          },
        ]}>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title={confirmLabel}
          variant="primary"
          loading={busy}
          disabled={disabled}
          onPress={apply}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 12.5 },
  resetBtn: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  resetText: { fontSize: 15, fontWeight: '600' },
  scroll: {
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    alignItems: 'center',
  },
  hint: { fontSize: 13.5, lineHeight: 19, alignSelf: 'stretch' },
  editor: { borderRadius: Radii.lg, overflow: 'hidden', backgroundColor: '#0a0a0a' },
  editorSpinner: { margin: 'auto' },
  editorError: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  editorErrorText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  corner: { position: 'absolute', width: 20, height: 20 },
  tl: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4 },
  tr: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4 },
  bl: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4 },
  br: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4 },
  toolRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tool: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radii.pill,
    paddingHorizontal: 14,
  },
  toolWide: { flex: 1 },
  toolFill: { flex: 1, alignItems: 'flex-end' },
  toolIcon: { fontSize: 18, fontWeight: '700' },
  toolLabel: { fontSize: 13, fontWeight: '700' },
  toolHint: { fontSize: 12 },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
