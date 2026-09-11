import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import FaceDetection from "@react-native-ml-kit/face-detection";
import { describeFaceGateReason, evaluateFaceGate, type FaceGateReason } from "../lib/face-gate.js";

const CAPTURE_INTERVAL_MS = 700;

export interface FaceScanCameraProps {
  onContinue: () => void;
  onCancel: () => void;
}

type Phase = "checking" | "explain" | "requesting" | "denied" | "scanning";
type ManualPhase = "idle" | "requesting";

/**
 * Requests the front camera only after the user explicitly taps "Allow
 * Camera", then periodically captures a still frame and runs it through
 * on-device ML Kit face detection. This gates the "Continue" button on a
 * clear, centered, eyes-open single face - it is a local sanity/liveness-ish
 * check, not identity matching and not a substitute for a real provider's
 * anti-spoofing pipeline. Captured frames are deleted immediately after
 * detection; nothing is stored or transmitted.
 */
export function FaceScanCamera({ onContinue, onCancel }: FaceScanCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualPhase, setManualPhase] = useState<ManualPhase>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [gateReason, setGateReason] = useState<FaceGateReason>("no-face");
  const [gateOk, setGateOk] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const isCapturingRef = useRef(false);

  // Derived directly from the permission hook's state during render, rather
  // than mirrored into state via an effect - avoids an extra render pass and
  // the "setState in effect" cascading-render pitfall.
  const phase: Phase = !permission
    ? "checking"
    : permission.granted
      ? "scanning"
      : manualPhase === "requesting"
        ? "requesting"
        : permission.canAskAgain
          ? "explain"
          : "denied";

  const captureAndDetect = useCallback(async () => {
    if (isCapturingRef.current || !cameraRef.current) return;
    isCapturingRef.current = true;
    let filePath: string | null = null;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: false });
      if (!photo) return;
      filePath = photo.uri;
      const faces = await FaceDetection.detect(photo.uri, { classificationMode: "all" });
      const result = evaluateFaceGate(faces, {
        imageWidth: photo.width,
        imageHeight: photo.height,
      });
      setGateOk(result.ok);
      setGateReason(result.reason);
    } catch {
      // A transient capture/detection failure just means "no face yet" -
      // the next tick will try again.
      setGateOk(false);
      setGateReason("no-face");
    } finally {
      if (filePath) {
        try {
          const file = new File(filePath);
          if (file.exists) file.delete();
        } catch {
          /* best-effort cleanup only */
        }
      }
      isCapturingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (phase !== "scanning" || !cameraReady) return;
    const interval = setInterval(() => {
      void captureAndDetect();
    }, CAPTURE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase, cameraReady, captureAndDetect]);

  async function handleAllowPress() {
    setManualPhase("requesting");
    await requestPermission();
    setManualPhase("idle");
  }

  if (phase === "denied") {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Camera access was denied</Text>
        <Text style={styles.body}>
          VerifyBridge needs your camera to continue. Enable it in your device settings and try
          again.
        </Text>
        <Pressable style={styles.primaryButton} onPress={handleAllowPress}>
          <Text style={styles.primaryButtonText}>Try again</Text>
        </Pressable>
        <Pressable onPress={onCancel}>
          <Text style={styles.linkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "scanning") {
    return (
      <View style={styles.container}>
        <Pressable onPress={onCancel} style={styles.cancelRow}>
          <Text style={styles.linkText}>Cancel</Text>
        </Pressable>
        <View style={styles.previewWrap}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="front"
            onCameraReady={() => setCameraReady(true)}
          />
          <View pointerEvents="none" style={styles.overlay}>
            <View style={[styles.faceGuide, gateOk && styles.faceGuideOk]} />
          </View>
        </View>
        <Text style={[styles.statusText, gateOk && styles.statusTextOk]}>
          {describeFaceGateReason(gateReason)}
        </Text>
        <Pressable
          style={[styles.primaryButton, !gateOk && styles.primaryButtonDisabled]}
          disabled={!gateOk}
          onPress={onContinue}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.centered}>
      <Text style={styles.title}>Camera access</Text>
      <Text style={styles.body}>
        We&apos;ll use your front camera to complete identity verification.
      </Text>
      <Text style={styles.faint}>
        Frames are analyzed on your device to confirm a face is visible and are never stored or
        uploaded.
      </Text>
      <Pressable
        style={styles.primaryButton}
        onPress={handleAllowPress}
        disabled={phase === "requesting"}
      >
        <Text style={styles.primaryButtonText}>
          {phase === "requesting" ? "Requesting…" : "Allow Camera"}
        </Text>
      </Pressable>
      <Pressable onPress={onCancel}>
        <Text style={styles.linkText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  centered: { alignItems: "center", gap: 12, paddingVertical: 16 },
  cancelRow: { alignItems: "flex-start" },
  previewWrap: {
    aspectRatio: 3 / 4,
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  faceGuide: {
    width: "60%",
    aspectRatio: 3 / 4,
    borderRadius: 200,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.7)",
  },
  faceGuideOk: { borderColor: "#22C55E" },
  statusText: { textAlign: "center", fontSize: 14, color: "#4B5563" },
  statusTextOk: { color: "#16A34A", fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "600", color: "#111827", textAlign: "center" },
  body: { fontSize: 14, color: "#4B5563", textAlign: "center" },
  faint: { fontSize: 12, color: "#9CA3AF", textAlign: "center" },
  primaryButton: {
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
  },
  primaryButtonDisabled: { backgroundColor: "#93C5FD" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
  linkText: { color: "#4B5563", fontSize: 14, textDecorationLine: "underline" },
});
