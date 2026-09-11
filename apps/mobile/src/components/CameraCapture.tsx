import { useEffect, useRef, useState } from "react";
import { Button, ErrorState } from "@verifybridge/ui";

export interface CameraCaptureProps {
  onContinue: () => void;
  onCancel: () => void;
}

type CameraState = "explain" | "requesting" | "active" | "denied";

/**
 * Requests the front camera only after the user explicitly taps "Allow
 * Camera" (never on mount) and never captures, stores, or transmits a
 * frame - the demo verification path is a deliberate confirmation button,
 * not a biometric check. See DemoVerificationProvider for why.
 */
export function CameraCapture({ onContinue, onCancel }: CameraCaptureProps) {
  const [state, setState] = useState<CameraState>("explain");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function requestCamera() {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setState("active");
      // The <video> element only mounts once state flips to "active", so
      // attach the stream on the next tick once the ref is available.
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      setState("denied");
    }
  }

  function stopAndCancel() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onCancel();
  }

  if (state === "denied") {
    return (
      <ErrorState
        title="Camera access was denied"
        description="VerifyBridge needs your camera to continue. Check your browser's site settings and try again."
        actionLabel="Try again"
        onAction={requestCamera}
      />
    );
  }

  if (state === "active") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={stopAndCancel}
            className="text-sm text-text-muted underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </div>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="size-full -scale-x-100 object-cover"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-3/5 w-3/5 rounded-[45%] border-4 border-white/70" />
          </div>
        </div>
        <p className="text-center text-sm text-text-muted">Keep your face clearly visible</p>
        <Button onClick={onContinue}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-lg font-semibold text-text">Camera access</h1>
      <p className="text-sm text-text-muted">
        We&apos;ll use your front camera to complete identity verification.
      </p>
      <p className="text-xs text-text-faint">
        No image is stored by VerifyBridge unless explicitly required by the verification
        provider.
      </p>
      <Button onClick={requestCamera} loading={state === "requesting"} className="mt-2 w-full">
        Allow Camera
      </Button>
      <button type="button" onClick={onCancel} className="text-sm text-text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}
