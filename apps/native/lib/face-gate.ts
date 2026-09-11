import type { Face } from "@react-native-ml-kit/face-detection";

export type FaceGateReason =
  "no-face" | "multiple-faces" | "too-small" | "off-center" | "eyes-closed" | "ok";

export interface FaceGateResult {
  ok: boolean;
  reason: FaceGateReason;
}

export interface FaceGateOptions {
  imageWidth: number;
  imageHeight: number;
  /** Minimum ratio of (detected face width / image width) to count as "close enough". */
  minFaceWidthRatio?: number;
  /** Maximum allowed distance between face center and image center, as a ratio of image width/height. */
  maxCenterOffsetRatio?: number;
  /** Minimum average eye-open probability (ML Kit classificationMode: "all") to count as "eyes open". */
  minEyeOpenProbability?: number;
}

const DEFAULT_MIN_FACE_WIDTH_RATIO = 0.28;
const DEFAULT_MAX_CENTER_OFFSET_RATIO = 0.22;
const DEFAULT_MIN_EYE_OPEN_PROBABILITY = 0.4;

/**
 * Pure gating logic for whether a captured still frame shows one clear,
 * reasonably-centered, reasonably-close, eyes-open face - the local
 * "liveness-ish" check that enables the demo completion button. This is not
 * identity matching (no comparison against a reference photo) and it is not
 * a substitute for a real provider's liveness/anti-spoofing pipeline - it
 * exists so the button can't be pressed against an empty frame or a photo
 * held up out of frame, nothing stronger than that.
 */
export function evaluateFaceGate(faces: Face[], options: FaceGateOptions): FaceGateResult {
  if (faces.length === 0) return { ok: false, reason: "no-face" };
  if (faces.length > 1) return { ok: false, reason: "multiple-faces" };

  const face = faces[0]!;
  const { imageWidth, imageHeight } = options;
  const minFaceWidthRatio = options.minFaceWidthRatio ?? DEFAULT_MIN_FACE_WIDTH_RATIO;
  const maxCenterOffsetRatio = options.maxCenterOffsetRatio ?? DEFAULT_MAX_CENTER_OFFSET_RATIO;
  const minEyeOpenProbability = options.minEyeOpenProbability ?? DEFAULT_MIN_EYE_OPEN_PROBABILITY;

  const faceWidthRatio = face.frame.width / imageWidth;
  if (faceWidthRatio < minFaceWidthRatio) return { ok: false, reason: "too-small" };

  const faceCenterX = face.frame.left + face.frame.width / 2;
  const faceCenterY = face.frame.top + face.frame.height / 2;
  const offsetX = Math.abs(faceCenterX - imageWidth / 2) / imageWidth;
  const offsetY = Math.abs(faceCenterY - imageHeight / 2) / imageHeight;
  if (offsetX > maxCenterOffsetRatio || offsetY > maxCenterOffsetRatio) {
    return { ok: false, reason: "off-center" };
  }

  const { leftEyeOpenProbability, rightEyeOpenProbability } = face;
  if (leftEyeOpenProbability !== undefined && rightEyeOpenProbability !== undefined) {
    const avgEyeOpen = (leftEyeOpenProbability + rightEyeOpenProbability) / 2;
    if (avgEyeOpen < minEyeOpenProbability) return { ok: false, reason: "eyes-closed" };
  }

  return { ok: true, reason: "ok" };
}

export function describeFaceGateReason(reason: FaceGateReason): string {
  switch (reason) {
    case "no-face":
      return "Position your face in the frame";
    case "multiple-faces":
      return "Only one person should be in frame";
    case "too-small":
      return "Move closer to the camera";
    case "off-center":
      return "Center your face in the frame";
    case "eyes-closed":
      return "Keep your eyes open";
    case "ok":
      return "Face detected";
  }
}
