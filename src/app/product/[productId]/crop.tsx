import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cropAspectPresets, type CropAspectId } from '@/lib/crop-aspects';
import { getImageSize, resolveImageUri, type CropRect } from '@/services/image-service';
import { useLibraryStore } from '@/stores/library-store';

const AnimatedImage = Animated.createAnimatedComponent(Image);

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Map the viewport crop frame + image transform onto pixels in the source. */
function computeCropFromTransform(
  imgW: number,
  imgH: number,
  fitScale: number,
  userScale: number,
  translateX: number,
  translateY: number,
  frame: { x: number; y: number; w: number; h: number },
  container: { w: number; h: number }
): CropRect {
  const scale = fitScale * userScale;
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  const imgLeft = container.w / 2 - dispW / 2 + translateX;
  const imgTop = container.h / 2 - dispH / 2 + translateY;

  let originX = (frame.x - imgLeft) / scale;
  let originY = (frame.y - imgTop) / scale;
  let width = frame.w / scale;
  let height = frame.h / scale;

  // Clamp to the image bounds.
  originX = Math.max(0, Math.min(imgW - 1, originX));
  originY = Math.max(0, Math.min(imgH - 1, originY));
  width = Math.max(1, Math.min(imgW - originX, width));
  height = Math.max(1, Math.min(imgH - originY, height));

  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export default function CropProductImageScreen() {
  const params = useLocalSearchParams<{ productId?: string | string[] }>();
  const productId = param(params.productId);
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();

  const product = useLibraryStore((s) => s.products.find((p) => p.id === productId));
  const settings = useLibraryStore((s) => s.exportSettings);
  const cropProduct = useLibraryStore((s) => s.cropProduct);

  const displayUri = resolveImageUri(product?.imageUri);

  // Presets follow the layout the catalogue will actually be exported with.
  const presets = useMemo(
    () => cropAspectPresets(settings.layoutId, settings.pageSize),
    [settings.layoutId, settings.pageSize]
  );

  const [aspectId, setAspectId] = useState<CropAspectId>('layout-cell');
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // JS-side mirror of the gesture transform, for the preview and for saving.
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [zoom, setZoom] = useState(1);

  const activePreset = presets.find((p) => p.id === aspectId) ?? presets[0];
  const aspect = activePreset.ratio;

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const editorW = Math.min(winW - 32, 400);
  const editorH = Math.min(editorW * 1.15, 420);

  const frame = useMemo(() => {
    const pad = 16;
    const maxW = editorW - pad * 2;
    const maxH = editorH - pad * 2;
    let fw: number;
    let fh: number;
    if (maxW / maxH > aspect) {
      fh = maxH;
      fw = fh * aspect;
    } else {
      fw = maxW;
      fh = fw / aspect;
    }
    return { w: fw, h: fh, x: (editorW - fw) / 2, y: (editorH - fh) / 2 };
  }, [editorW, editorH, aspect]);

  /** Scale that fits the whole image inside the editor. */
  const fitScale = useMemo(() => {
    if (!imgSize) return 1;
    return Math.min(editorW / imgSize.width, editorH / imgSize.height);
  }, [imgSize, editorW, editorH]);

  /** Minimum zoom that still covers the crop frame — no empty corners. */
  const minZoom = useMemo(() => {
    if (!imgSize) return 1;
    const coverX = frame.w / (imgSize.width * fitScale);
    const coverY = frame.h / (imgSize.height * fitScale);
    return Math.max(coverX, coverY, 1);
  }, [imgSize, fitScale, frame]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!product?.imageUri) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const size = await getImageSize(product.imageUri);
        if (!cancelled) setImgSize(size);
      } catch (e) {
        if (!cancelled) {
          Alert.alert('Error', e instanceof Error ? e.message : 'Could not read the image size.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product?.imageUri]);

  // Reset the transform whenever the target aspect changes.
  useEffect(() => {
    const z = Math.max(minZoom, 1);
    scale.value = z;
    translateX.value = 0;
    translateY.value = 0;
    setZoom(z);
    setTx(0);
    setTy(0);
  }, [aspectId, minZoom, scale, translateX, translateY]);

  const syncTransform = (x: number, y: number, z: number) => {
    setTx(x);
    setTy(y);
    setZoom(z);
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
      translateY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      runOnJS(syncTransform)(translateX.value, translateY.value, scale.value);
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(6, Math.max(minZoom, startScale.value * e.scale));
    })
    .onEnd(() => {
      runOnJS(syncTransform)(translateX.value, translateY.value, scale.value);
    });

  const composed = Gesture.Simultaneous(pan, pinch);

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

  const cropRect = useMemo(() => {
    if (!imgSize) return null;
    return computeCropFromTransform(
      imgSize.width,
      imgSize.height,
      fitScale,
      zoom,
      tx,
      ty,
      frame,
      { w: editorW, h: editorH }
    );
  }, [imgSize, fitScale, zoom, tx, ty, frame, editorW, editorH]);

  /** How the crop will look once it lands in a PDF cell. */
  const resultPreview = useMemo(() => {
    if (!imgSize || !cropRect || !displayUri) return null;
    const maxSide = 120;
    const boxW = aspect >= 1 ? maxSide : maxSide * aspect;
    const boxH = aspect >= 1 ? maxSide / aspect : maxSide;
    const s = Math.max(boxW / cropRect.width, boxH / cropRect.height);
    return {
      boxW,
      boxH,
      imgW: imgSize.width * s,
      imgH: imgSize.height * s,
      left: -cropRect.originX * s,
      top: -cropRect.originY * s,
    };
  }, [imgSize, cropRect, displayUri, aspect]);

  const onApply = useCallback(async () => {
    // Read the live shared values — the JS mirror may lag a gesture.
    const rect =
      imgSize &&
      computeCropFromTransform(
        imgSize.width,
        imgSize.height,
        fitScale,
        scale.value,
        translateX.value,
        translateY.value,
        frame,
        { w: editorW, h: editorH }
      );
    if (!productId || !rect) return;

    setSaving(true);
    try {
      await cropProduct(productId, rect);
      router.back();
    } catch (e) {
      Alert.alert('Crop failed', e instanceof Error ? e.message : 'Could not crop the image.');
    } finally {
      setSaving(false);
    }
  }, [
    productId,
    imgSize,
    fitScale,
    scale,
    translateX,
    translateY,
    frame,
    editorW,
    editorH,
    cropProduct,
    router,
  ]);

  if (!product || !displayUri) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        {loading ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <ThemedText>This product is no longer available.</ThemedText>
        )}
      </View>
    );
  }

  return (
    <View
      style={[styles.screen, { backgroundColor: theme.background, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          Drag to pan, pinch to zoom. The framed area is what gets saved — the card below shows
          the result.
        </ThemedText>

        <View
          style={[styles.editor, { width: editorW, height: editorH, backgroundColor: '#0a0a0a' }]}>
          {loading || !imgSize ? (
            <ActivityIndicator color={theme.accent} style={{ margin: 'auto' }} />
          ) : (
            <GestureDetector gesture={composed}>
              <View style={{ width: editorW, height: editorH, overflow: 'hidden' }}>
                <AnimatedImage source={{ uri: displayUri }} style={imageStyle} contentFit="fill" />

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

                  <View
                    style={[
                      styles.frameLabel,
                      { backgroundColor: theme.accent, top: Math.max(4, frame.y - 22) },
                    ]}>
                    <ThemedText style={styles.frameLabelText}>Saved area</ThemedText>
                  </View>
                </View>
              </View>
            </GestureDetector>
          )}
        </View>

        <View
          style={[
            styles.resultCard,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <View style={styles.resultHeader}>
            <ThemedText style={styles.sectionLabel}>On save</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.resultSub}>
              {product.formulaName} · {product.companyName}
            </ThemedText>
          </View>
          <View style={styles.resultRow}>
            <View
              style={[
                styles.resultBox,
                {
                  width: resultPreview?.boxW ?? 100,
                  height: resultPreview?.boxH ?? 140,
                  borderColor: theme.accent,
                  backgroundColor: '#111',
                },
              ]}>
              {resultPreview ? (
                <View
                  style={{
                    width: resultPreview.boxW,
                    height: resultPreview.boxH,
                    overflow: 'hidden',
                  }}>
                  <Image
                    source={{ uri: displayUri }}
                    style={{
                      position: 'absolute',
                      width: resultPreview.imgW,
                      height: resultPreview.imgH,
                      left: resultPreview.left,
                      top: resultPreview.top,
                    }}
                    contentFit="fill"
                  />
                </View>
              ) : (
                <ActivityIndicator color={theme.accent} />
              )}
            </View>
            <View style={styles.resultMeta}>
              <ThemedText style={styles.resultTitle}>{activePreset.label}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.resultDesc}>
                {activePreset.hint}
              </ThemedText>
              {cropRect ? (
                <ThemedText themeColor="textSecondary" style={styles.resultSize}>
                  {cropRect.width}×{cropRect.height}px
                </ThemedText>
              ) : null}
              <ThemedText themeColor="textSecondary" style={styles.resultHint}>
                This is exactly what the PDF cell will show.
              </ThemedText>
            </View>
          </View>
        </View>

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
                onPress={() => setAspectId(preset.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? theme.accent : theme.backgroundElement,
                    borderColor: on ? theme.accent : theme.border,
                  },
                ]}>
                <ThemedText style={[styles.chipTitle, { color: on ? '#1A1A1A' : theme.text }]}>
                  {preset.label}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.chipHint,
                    { color: on ? 'rgba(0,0,0,0.55)' : theme.textSecondary },
                  ]}>
                  {preset.hint}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: theme.border, backgroundColor: theme.background },
        ]}>
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button
          title="Apply crop"
          variant="accent"
          loading={saving}
          disabled={!cropRect || loading}
          onPress={onApply}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  scroll: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
    alignItems: 'center',
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    alignSelf: 'stretch',
  },
  editor: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
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
  corner: {
    position: 'absolute',
    width: 16,
    height: 16,
  },
  tl: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3 },
  frameLabel: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    transform: [{ translateX: -40 }],
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  frameLabelText: {
    color: '#1A1A1A',
    fontSize: 11,
    fontWeight: '800',
  },
  resultCard: {
    alignSelf: 'stretch',
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  resultHeader: { gap: 2 },
  resultSub: { fontSize: 12 },
  resultRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  resultBox: {
    borderRadius: Radii.sm,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultMeta: { flex: 1, gap: 4 },
  resultTitle: { fontSize: 16, fontWeight: '700' },
  resultDesc: { fontSize: 13 },
  resultSize: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  resultHint: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionLabel: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  chips: {
    gap: Spacing.two,
    paddingVertical: 4,
    alignItems: 'center',
  },
  chip: {
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 96,
  },
  chipTitle: { fontSize: 14, fontWeight: '700' },
  chipHint: { fontSize: 11, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
