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

import { CroppedImage } from '@/components/cropped-image';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cropAspectPresets,
  layoutCellAspects,
  nearestPreset,
  type CropAspectPreset,
  type PageContext,
} from '@/lib/crop-aspects';
import { PROBE_MAX_EDGE } from '@/lib/auto-trim';
import {
  adaptRectToAspect,
  aspectOf,
  centreRectForAspect,
  coverageForAspect,
  rotateNormalized,
  safeRectAcrossAspects,
  toNormalized,
  toPixels,
  type NormalizedRect,
  type PixelRect,
  type Size,
} from '@/lib/crop-geometry';
import { reportError, toMessage } from '@/lib/errors';
import { renderRotatedCopy, toProbeDataUri } from '@/services/image-service';
import { asRotation, type Rotation } from '@/types/models';

import { AutoTrimProbe } from './auto-trim-probe';

const AnimatedImage = Animated.createAnimatedComponent(Image);

/** Below this share of the frame kept, a layout is flagged as trimming. */
const COVERAGE_WARN = 0.995;

/** Every grid cell, the usual print ratios, and the photo's own shape. */
function buildPresets(page: PageContext, imgSize: Size | null): CropAspectPreset[] {
  const base = cropAspectPresets(page);
  if (!imgSize) return base;
  const source: CropAspectPreset = {
    id: 'source',
    label: 'Original',
    hint: "The photo's own shape",
    ratio: imgSize.width / imgSize.height,
    group: 'source',
  };
  return [...base, source];
}

export type CropResult = {
  crop: NormalizedRect;
  sourceSize: Size;
  rotation: Rotation;
};

type Props = {
  /** Source image, already resolved to something the manipulator can open. */
  uri: string;
  /** Existing framing to reopen, in fractions of the source. */
  initialCrop?: NormalizedRect | null;
  initialRotation?: Rotation;
  /** Export settings the previews are measured against. */
  page: PageContext;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: CropResult) => void | Promise<void>;
};

/**
 * Non-destructive crop editor.
 *
 * What comes back is a rect, not an image — the pixels are never rewritten.
 * That is what lets the aspect templates be swapped freely and what makes the
 * "in every layout" strip honest: each grid re-derives its own rect from the
 * same framing, growing outwards into the untouched source where it needs to.
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);

  // Rotation is stored, never burnt in: the working image below is the source
  // re-rendered at the current angle, so the frame maths stays plain upright
  // geometry no matter which way the photo was held.
  const [rotation, setRotation] = useState<Rotation>(initialRotation);
  const [workingUri, setWorkingUri] = useState<string>(uri);
  const [rotating, setRotating] = useState(false);

  // Auto-trim runs off a downscaled copy and only ever offers a suggestion.
  const [probeUri, setProbeUri] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<NormalizedRect | null>(null);
  const [suggestionUsed, setSuggestionUsed] = useState(false);

  // JS-side mirror of the gesture transform, driving the previews.
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [zoom, setZoom] = useState(1);

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const gridAspects = useMemo(
    () => layoutCellAspects({ pageSize: page.pageSize, contactBox: page.contactBox }),
    [page.pageSize, page.contactBox]
  );

  // Primitives, so the preset list stays stable across re-renders even when
  // the caller rebuilds the `page` object inline.
  const presets = useMemo(
    () =>
      buildPresets(
        { layoutId: page.layoutId, pageSize: page.pageSize, contactBox: page.contactBox },
        imgSize
      ),
    [page.layoutId, page.pageSize, page.contactBox, imgSize]
  );

  const [aspectId, setAspectId] = useState<string>(presets[0]?.id ?? 'layout:2-col');
  const activePreset = presets.find((p) => p.id === aspectId) ?? presets[0];
  const aspect = activePreset?.ratio ?? 1;

  /**
   * A framing waiting to be placed once the layout for its aspect is current.
   * Held normalized because a rotation swaps the working image's dimensions
   * out from under any pixel rect.
   */
  const pendingFrame = useRef<NormalizedRect | null>(null);
  const placed = useRef(false);

  // Mount-time snapshot for the first placement. The editor is mounted fresh
  // for each open, so these are the props that opened it — and keeping them
  // out of the load effect's deps stops a caller re-render from re-framing
  // whatever the user has since dragged to.
  const [boot] = useState(() => ({ page, initialCrop }));

  const editorW = Math.min(winW - Spacing.three * 2, 420);
  const editorH = Math.min(Math.max(winH * 0.42, 260), 440);

  /** The fixed crop window drawn in the editor, for the current aspect. */
  const frame = useMemo(() => {
    const pad = Spacing.three;
    const maxW = editorW - pad * 2;
    const maxH = editorH - pad * 2;
    let w: number;
    let h: number;
    if (maxW / maxH > aspect) {
      h = maxH;
      w = h * aspect;
    } else {
      w = maxW;
      h = w / aspect;
    }
    return { w, h, x: (editorW - w) / 2, y: (editorH - h) / 2 };
  }, [editorW, editorH, aspect]);

  /** Scale that fits the whole image inside the editor. */
  const fitScale = useMemo(() => {
    if (!imgSize) return 1;
    return Math.min(editorW / imgSize.width, editorH / imgSize.height);
  }, [imgSize, editorW, editorH]);

  /* ------------------------------------------------------------ transform io */

  /** Place the transform so `rect` exactly fills the crop frame. */
  const applyPixelRect = useCallback(
    (rect: PixelRect) => {
      if (!imgSize) return;
      const s = frame.w / Math.max(1, rect.width);
      const dispW = imgSize.width * s;
      const dispH = imgSize.height * s;
      const nextX = frame.x - rect.originX * s - (editorW / 2 - dispW / 2);
      const nextY = frame.y - rect.originY * s - (editorH / 2 - dispH / 2);
      const nextZoom = s / fitScale;

      scale.value = nextZoom;
      translateX.value = nextX;
      translateY.value = nextY;
      setZoom(nextZoom);
      setTx(nextX);
      setTy(nextY);
    },
    [imgSize, frame, editorW, editorH, fitScale, scale, translateX, translateY]
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

      // Size is clamped before the origin so the rect keeps the frame's shape —
      // clamping both independently is what used to hand the exporter a rect
      // that no longer matched the aspect the user had chosen.
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

  /* ----------------------------------------------------------------- loading */

  /**
   * Render the working image for the current angle and measure it. Runs again
   * on every rotation, which is why the pending frame is carried in normalized
   * form: a quarter turn swaps the pixel dimensions underneath it.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const rendered = await renderRotatedCopy(uri, rotation);
        if (cancelled) return;
        const size = { width: rendered.width, height: rendered.height };
        setWorkingUri(rendered.uri);
        setImgSize(size);

        // First placement, decided here rather than in an effect that reacts
        // to the size landing. An existing crop also selects the template
        // closest to its shape, so reopening an edit lands on the frame the
        // user left behind instead of silently reshaping it.
        if (!placed.current) {
          placed.current = true;
          const list = buildPresets(boot.page, size);
          if (boot.initialCrop) {
            pendingFrame.current = boot.initialCrop;
            setAspectId(nearestPreset(list, aspectOf(toPixels(boot.initialCrop, size))).id);
          } else {
            // No crop yet, so the frame starts on the template already chosen.
            pendingFrame.current = toNormalized(
              centreRectForAspect(size, list[0].ratio),
              size
            );
          }
        }

        // Scan for the pack against its background, in the background.
        void toProbeDataUri(rendered.uri, { maxEdge: PROBE_MAX_EDGE }).then((probe) => {
          if (!cancelled) setProbeUri(probe);
        });
      } catch (e) {
        reportError('image', e);
        // An alert alone left the editor spinning forever once dismissed —
        // the state has to say why there is nothing to show.
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

  /**
   * Switching template reshapes the frame in place instead of resetting it,
   * using the same growth rule the exporter applies per grid cell.
   */
  useEffect(() => {
    if (!imgSize) return;
    const frameRect = pendingFrame.current;
    if (!frameRect) return;
    pendingFrame.current = null;
    applyPixelRect(adaptRectToAspect(toPixels(frameRect, imgSize), aspect, imgSize));
  }, [imgSize, aspect, applyPixelRect]);

  /** Current framing in normalized form, safe to carry across a rotation. */
  const currentFrame = useCallback((): NormalizedRect | null => {
    if (!imgSize) return null;
    const rect = rectFromTransform(translateX.value, translateY.value, scale.value);
    return rect ? toNormalized(rect, imgSize) : null;
  }, [imgSize, rectFromTransform, translateX, translateY, scale]);

  const chooseAspect = (next: CropAspectPreset) => {
    if (next.id === aspectId) return;
    pendingFrame.current = currentFrame();
    setAspectId(next.id);
  };

  /** Turn the photo, carrying the framing round with it. */
  const rotateBy = (quarterTurns: number) => {
    if (!imgSize || rotating) return;
    const frameRect = currentFrame();
    pendingFrame.current = frameRect ? rotateNormalized(frameRect, quarterTurns) : null;
    setRotating(true);
    setRotation(asRotation(rotation + quarterTurns * 90));
  };

  const applySuggestion = () => {
    if (!imgSize || !suggestion) return;
    // Reshaped to the active template, so the suggestion still fits the cell.
    applyPixelRect(adaptRectToAspect(toPixels(suggestion, imgSize), aspect, imgSize));
    setSuggestionUsed(true);
  };

  const reset = () => {
    if (!imgSize) return;
    applyPixelRect(centreRectForAspect(imgSize, aspect));
  };

  /* ---------------------------------------------------------------- gestures */

  const syncTransform = (x: number, y: number, z: number) => {
    setTx(x);
    setTy(y);
    setZoom(z);
  };

  const setPanningJS = (value: boolean) => setPanning(value);

  const minZoom = useMemo(() => {
    if (!imgSize) return 1;
    return Math.max(
      frame.w / (imgSize.width * fitScale),
      frame.h / (imgSize.height * fitScale),
      0.01
    );
  }, [imgSize, fitScale, frame]);

  const gesture = useMemo(() => {
    const width = imgSize?.width ?? 0;
    const height = imgSize?.height ?? 0;

    /**
     * Hold the frame over the image. Clamping the translation instead of the
     * resulting rect is what keeps the saved crop the exact shape the frame
     * shows, even when the image is dragged hard against an edge.
     */
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
        const next = Math.min(8, Math.max(minZoom, startScale.value * e.scale));
        scale.value = next;
        // Zooming out can uncover an edge, so the pan has to be re-clamped.
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

  /* ----------------------------------------------------------- safe overlay */

  /**
   * The part of the frame every export grid keeps. Where a grid cannot grow
   * outwards far enough it has to trim instead, and this is what survives all
   * of them — the marker is the promise the editor can actually make.
   */
  const safeOverlay = useMemo(() => {
    if (!imgSize || !cropRect) return null;
    const safe = safeRectAcrossAspects(
      cropRect,
      gridAspects.map((g) => g.aspect),
      imgSize
    );
    if (!safe) return null;

    const s = fitScale * zoom;
    const dispW = imgSize.width * s;
    const dispH = imgSize.height * s;
    const imgLeft = editorW / 2 - dispW / 2 + tx;
    const imgTop = editorH / 2 - dispH / 2 + ty;

    const box = {
      left: imgLeft + safe.originX * s,
      top: imgTop + safe.originY * s,
      width: safe.width * s,
      height: safe.height * s,
    };
    // Within a pixel of the frame there is nothing to warn about.
    const tight = box.width >= frame.w - 1.5 && box.height >= frame.h - 1.5;
    return tight ? null : box;
  }, [imgSize, cropRect, gridAspects, fitScale, zoom, tx, ty, editorW, editorH, frame]);

  /* --------------------------------------------------------- grid previews */

  const normalizedCrop = useMemo(
    () => (imgSize && cropRect ? toNormalized(cropRect, imgSize) : null),
    [imgSize, cropRect]
  );

  const gridPreviews = useMemo(() => {
    if (!imgSize || !cropRect) return [];
    return gridAspects.map((grid) => {
      const coverage = coverageForAspect(cropRect, grid.aspect, imgSize);
      // The swatch has to be the cell's exact shape — clamping its width would
      // show the crop at a ratio no layout actually prints.
      const boxH = 66;
      const boxW = boxH * grid.aspect;
      return { ...grid, coverage, boxW, boxH, trims: coverage < COVERAGE_WARN };
    });
  }, [imgSize, cropRect, gridAspects]);

  const trimmedCount = gridPreviews.filter((g) => g.trims).length;

  /* ------------------------------------------------------------------ apply */

  const apply = async () => {
    if (!imgSize) return;
    // Read the live shared values — the JS mirror can lag a gesture.
    const rect = rectFromTransform(translateX.value, translateY.value, scale.value);
    if (!rect) return;
    // The crop is expressed against the rotated image, which is exactly the
    // order the renderer applies them in: rotate, then crop.
    await onConfirm({ crop: toNormalized(rect, imgSize), sourceSize: imgSize, rotation });
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
          hitSlop={8}
          style={({ pressed }) => [styles.resetBtn, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
          <ThemedText style={[styles.resetText, { color: theme.primary }]}>Reset</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        scrollEnabled={!panning}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          Drag to move, pinch to zoom. The solid frame is what you are keeping — nothing outside
          it is thrown away, so you can re-crop this shot any time.
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

                  {safeOverlay ? (
                    <View
                      style={[
                        styles.safeBox,
                        {
                          left: safeOverlay.left,
                          top: safeOverlay.top,
                          width: safeOverlay.width,
                          height: safeOverlay.height,
                        },
                      ]}
                    />
                  ) : null}

                  <View
                    style={[
                      styles.frameLabel,
                      { backgroundColor: theme.accent, top: Math.max(4, frame.y - 22) },
                    ]}>
                    <ThemedText style={styles.frameLabelText}>KEEPING THIS</ThemedText>
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
            style={[
              styles.tool,
              { borderColor: theme.border, opacity: disabled ? 0.4 : 1 },
            ]}>
            <ThemedText style={styles.toolIcon}>↺</ThemedText>
            <ThemedText style={styles.toolLabel}>Left</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rotate right"
            onPress={() => rotateBy(1)}
            disabled={disabled}
            style={[
              styles.tool,
              { borderColor: theme.border, opacity: disabled ? 0.4 : 1 },
            ]}>
            <ThemedText style={styles.toolIcon}>↻</ThemedText>
            <ThemedText style={styles.toolLabel}>Right</ThemedText>
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
              <ThemedText style={styles.toolIcon}>⤢</ThemedText>
              <ThemedText style={[styles.toolLabel, { color: theme.primary }]}>
                Snap to pack
              </ThemedText>
            </Pressable>
          ) : (
            <View style={styles.toolFill}>
              <ThemedText themeColor="textSecondary" style={styles.toolHint}>
                {rotation ? `Rotated ${rotation}°` : 'Upright'}
                {suggestionUsed ? ' · snapped to the pack' : ''}
              </ThemedText>
            </View>
          )}
        </View>

        {safeOverlay ? (
          <ThemedText themeColor="textSecondary" style={styles.safeNote}>
            The dashed box is what survives every grid. {trimmedCount} of {gridPreviews.length}{' '}
            layouts trim past it — zoom out to bring more of the pack inside.
          </ThemedText>
        ) : null}

        <ThemedText style={styles.sectionLabel}>In every layout</ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}>
          {gridPreviews.map((grid) => (
            <View key={grid.id} style={styles.gridItem}>
              <View
                style={[
                  styles.gridBox,
                  {
                    width: grid.boxW,
                    height: grid.boxH,
                    borderColor: grid.trims ? theme.danger : theme.border,
                  },
                ]}>
                <CroppedImage
                  uri={workingUri}
                  crop={normalizedCrop}
                  sourceSize={imgSize}
                  aspect={grid.aspect}
                  transition={0}
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <ThemedText style={styles.gridName} numberOfLines={1}>
                {grid.name}
              </ThemedText>
              <ThemedText
                style={[
                  styles.gridMeta,
                  { color: grid.trims ? theme.danger : theme.textSecondary },
                ]}>
                {grid.trims ? `−${Math.round((1 - grid.coverage) * 100)}%` : 'Full frame'}
              </ThemedText>
            </View>
          ))}
        </ScrollView>

        <ThemedText style={styles.sectionLabel}>Aspect ratio</ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {presets.map((preset) => {
            const on = preset.id === aspectId;
            return (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => chooseAspect(preset)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? theme.primary : theme.backgroundElement,
                    borderColor: on ? theme.primary : theme.border,
                  },
                ]}>
                <ThemedText style={[styles.chipTitle, { color: on ? theme.fabIcon : theme.text }]}>
                  {preset.label}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.chipHint,
                    { color: on ? theme.fabIcon : theme.textSecondary, opacity: on ? 0.85 : 1 },
                  ]}>
                  {preset.hint}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {cropRect ? (
          <ThemedText themeColor="textSecondary" style={styles.sizeNote}>
            Saving {cropRect.width}×{cropRect.height}px of a {imgSize?.width}×{imgSize?.height}px
            photo · the full photo is kept on the device.
          </ThemedText>
        ) : null}
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
  editor: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
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
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  corner: { position: 'absolute', width: 16, height: 16 },
  tl: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3 },
  safeBox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.9)',
  },
  frameLabel: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    transform: [{ translateX: -46 }],
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  frameLabelText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  toolRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  toolWide: { flex: 1, justifyContent: 'center' },
  toolFill: { flex: 1, alignItems: 'flex-end' },
  toolIcon: { fontSize: 15, fontWeight: '700' },
  toolLabel: { fontSize: 13, fontWeight: '600' },
  toolHint: { fontSize: 12 },
  safeNote: { alignSelf: 'stretch', fontSize: 12.5, lineHeight: 18 },
  sectionLabel: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  strip: { gap: Spacing.three, paddingVertical: 2, alignItems: 'flex-start' },
  gridItem: { alignItems: 'center', gap: 3, maxWidth: 110 },
  gridBox: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  gridName: { fontSize: 11, fontWeight: '600' },
  gridMeta: { fontSize: 10.5, fontWeight: '600' },
  chips: { gap: Spacing.two, paddingVertical: 4, alignItems: 'center' },
  chip: {
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 96,
  },
  chipTitle: { fontSize: 14, fontWeight: '700' },
  chipHint: { fontSize: 11, marginTop: 2 },
  sizeNote: { alignSelf: 'stretch', fontSize: 12, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
