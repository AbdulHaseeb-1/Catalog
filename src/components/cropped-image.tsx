import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { effectiveCrop, type NormalizedRect } from '@/lib/crop-geometry';
import { rotatedSize, type Rotation } from '@/types/models';

type Props = {
  /** Already resolved to something <Image> can open. */
  uri: string | null;
  crop?: NormalizedRect | null;
  /**
   * Pixel size of the master image, *unrotated* — the same numbers the product
   * row stores. Without it the crop cannot be placed.
   */
  sourceSize?: { width: number; height: number } | null;
  /** Quarter turns applied before the crop, matching the export pipeline. */
  rotation?: Rotation;
  /**
   * Cell shape to render into (W/H). Defaults to the measured box, which is
   * what a square tile or a fixed-aspect card wants.
   */
  aspect?: number;
  style?: StyleProp<ViewStyle>;
  transition?: number;
  accessibilityLabel?: string;
};

/**
 * Shows the part of an image a product is actually framed to.
 *
 * Rotation then crop, in that order — the same order the exporter uses — and
 * the crop is reshaped to the box's aspect with the same maths. A tile here
 * and a cell in the PDF therefore show the same pixels; the app showing an
 * uncropped shot the catalogue then trims was the whole reason framing felt
 * unpredictable.
 */
export function CroppedImage({
  uri,
  crop,
  sourceSize,
  rotation = 0,
  aspect,
  style,
  transition = 120,
  accessibilityLabel,
}: Props) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (!width || !height) return;
    // Sub-pixel layout jitter would otherwise re-render on every frame.
    if (box && Math.abs(box.width - width) < 0.5 && Math.abs(box.height - height) < 0.5) return;
    setBox({ width, height });
  };

  // The crop was drawn against the rotated frame, so that is the space its
  // fractions have to be resolved in.
  const uprightSize = sourceSize ?? null;
  const framedSize = uprightSize ? rotatedSize(uprightSize, rotation) : null;

  const targetAspect = aspect ?? (box ? box.width / box.height : 1);
  const rect = box ? effectiveCrop(crop, framedSize, targetAspect) : null;

  const placed =
    rect && box && uprightSize && framedSize
      ? (() => {
          const scale = Math.max(box.width / rect.width, box.height / rect.height);
          return {
            left: -rect.originX * scale,
            top: -rect.originY * scale,
            // Rotating happens about the centre, so the turned image is laid
            // out inside a box of its post-rotation size and centred there.
            frameW: framedSize.width * scale,
            frameH: framedSize.height * scale,
            imageW: uprightSize.width * scale,
            imageH: uprightSize.height * scale,
          };
        })()
      : null;

  return (
    <View style={[styles.clip, style]} onLayout={onLayout}>
      {!uri ? null : placed ? (
        <View
          style={{
            position: 'absolute',
            left: placed.left,
            top: placed.top,
            width: placed.frameW,
            height: placed.frameH,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Image
            source={{ uri }}
            accessibilityLabel={accessibilityLabel}
            transition={transition}
            contentFit="fill"
            style={{
              width: placed.imageW,
              height: placed.imageH,
              transform: rotation ? [{ rotate: `${rotation}deg` }] : undefined,
            }}
          />
        </View>
      ) : (
        <Image
          source={{ uri }}
          accessibilityLabel={accessibilityLabel}
          transition={transition}
          contentFit="cover"
          style={[
            StyleSheet.absoluteFill,
            rotation ? { transform: [{ rotate: `${rotation}deg` }] } : null,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
