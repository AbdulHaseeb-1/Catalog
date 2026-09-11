import { useCallback, useEffect, useMemo, useState } from "react";
import type { MobileSessionView } from "@verifybridge/shared";
import {
  Badge,
  Button,
  Card,
  Countdown,
  ErrorState,
  Spinner,
  SuccessState,
} from "@verifybridge/ui";
import { ApiClientError } from "@verifybridge/verification-sdk";
import { CameraCapture } from "./components/CameraCapture";
import { apiClient } from "./lib/api-client";
import { attemptAppRedirect, isMobileOs } from "./lib/app-redirect";

type ViewState =
  | { kind: "loading" }
  | { kind: "invalid-link" }
  | { kind: "expired" }
  | { kind: "landing"; session: MobileSessionView }
  | { kind: "camera"; session: MobileSessionView }
  | { kind: "verifying"; session: MobileSessionView }
  | { kind: "success" }
  | { kind: "failure" }
  | { kind: "error"; message: string };

function parseToken(): string | null {
  const match = window.location.pathname.match(/^\/session\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function viewForSession(session: MobileSessionView): ViewState {
  if (session.status === "VERIFIED" || session.status === "CONSUMED") return { kind: "success" };
  if (session.status === "FAILED") return { kind: "failure" };
  if (session.status === "VERIFYING" || session.status === "CAMERA_GRANTED") {
    return { kind: "verifying", session };
  }
  return { kind: "landing", session };
}

export default function App() {
  const token = useMemo(() => parseToken(), []);
  const [view, setView] = useState<ViewState>(() =>
    token ? { kind: "loading" } : { kind: "invalid-link" },
  );
  // Desktop browsers have no native app to hand off to - only attempt it on
  // a phone/tablet OS (see isMobileOs's doc comment for why this also
  // matters for correctness, not just UX).
  const shouldAttemptAppRedirect = useMemo(
    () => Boolean(token) && isMobileOs(navigator.userAgent),
    [token],
  );
  const [redirectStatus, setRedirectStatus] = useState<"attempting" | "resolved">(
    shouldAttemptAppRedirect ? "attempting" : "resolved",
  );

  useEffect(() => {
    if (!token || !shouldAttemptAppRedirect) return;
    const controller = attemptAppRedirect(token, () => setRedirectStatus("resolved"));
    return () => controller.cancel();
  }, [token, shouldAttemptAppRedirect]);

  const handleError = useCallback((error: unknown): ViewState => {
    if (error instanceof ApiClientError) {
      if (error.code === "SESSION_EXPIRED") return { kind: "expired" };
      if (error.code === "SESSION_NOT_FOUND") return { kind: "invalid-link" };
      return { kind: "error", message: error.message };
    }
    return { kind: "error", message: "Something went wrong. Please try again." };
  }, []);

  useEffect(() => {
    if (!token) return;
    apiClient
      .getMobileSession(token)
      .then((session) => setView(viewForSession(session)))
      .catch((error: unknown) => setView(handleError(error)));
  }, [token, handleError]);

  async function handleContinueFromLanding() {
    if (!token) return;
    setView((prev) => (prev.kind === "landing" ? { kind: "camera", session: prev.session } : prev));
  }

  async function handleCameraContinue() {
    if (!token) return;
    try {
      const session = await apiClient.startMobileVerification(token);
      setView(viewForSession(session));
    } catch (error) {
      setView(handleError(error));
    }
  }

  function handleCameraCancel() {
    setView((prev) => (prev.kind === "camera" ? { kind: "landing", session: prev.session } : prev));
  }

  async function handleCompleteDemo(outcome: "success" | "failure") {
    if (!token) return;
    try {
      const session = await apiClient.completeDemoVerification(token, outcome);
      setView(viewForSession(session));
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "SESSION_CONSUMED") {
        // Already resolved (e.g. a double-tap) - re-fetch to show the real outcome.
        try {
          const session = await apiClient.getMobileSession(token);
          setView(viewForSession(session));
          return;
        } catch {
          /* fall through to generic error below */
        }
      }
      setView(handleError(error));
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <header className="text-center">
        <p className="text-sm font-semibold tracking-wide text-accent">VerifyBridge</p>
      </header>
      <Card padding="lg">
        {shouldAttemptAppRedirect && redirectStatus === "attempting" ? (
          <OpeningAppView onContinueInBrowser={() => setRedirectStatus("resolved")} />
        ) : (
          <ViewBody
            view={view}
            onContinueFromLanding={handleContinueFromLanding}
            onCameraContinue={handleCameraContinue}
            onCameraCancel={handleCameraCancel}
            onCompleteDemo={handleCompleteDemo}
            onExpire={() => setView({ kind: "expired" })}
          />
        )}
      </Card>
    </div>
  );
}

function OpeningAppView({ onContinueInBrowser }: { onContinueInBrowser: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <Spinner size="lg" label="Opening the VerifyBridge app" />
      <p className="text-sm text-text-muted">
        Opening the VerifyBridge app if it&apos;s installed…
      </p>
      <button
        type="button"
        onClick={onContinueInBrowser}
        className="text-sm text-text-muted underline-offset-2 hover:underline"
      >
        Continue in browser instead
      </button>
    </div>
  );
}

interface ViewBodyProps {
  view: ViewState;
  onContinueFromLanding: () => void;
  onCameraContinue: () => void;
  onCameraCancel: () => void;
  onCompleteDemo: (outcome: "success" | "failure") => void;
  onExpire: () => void;
}

function ViewBody({
  view,
  onContinueFromLanding,
  onCameraContinue,
  onCameraCancel,
  onCompleteDemo,
  onExpire,
}: ViewBodyProps) {
  switch (view.kind) {
    case "loading":
      return (
        <div className="flex justify-center py-10">
          <Spinner size="lg" label="Loading verification session" />
        </div>
      );

    case "invalid-link":
      return (
        <ErrorState
          title="This isn't a valid verification link"
          description="Ask the desktop site to generate a new QR code or link, then try again."
        />
      );

    case "expired":
      return (
        <ErrorState
          title="This link has expired"
          description="Verification links are valid for a few minutes. Go back to your computer and start again."
        />
      );

    case "error":
      return <ErrorState title="Something went wrong" description={view.message} />;

    case "landing":
      return (
        <div className="flex flex-col gap-5 text-center">
          <h1 className="text-lg font-semibold text-text">Verify your identity</h1>
          <p className="text-sm text-text-muted">
            You&apos;re securely continuing verification from your desktop.
          </p>
          <div className="rounded-md border border-border bg-canvas px-3 py-2 text-sm">
            <p className="text-text-faint">Website</p>
            <p className="font-medium text-text">{view.session.origin}</p>
          </div>
          <Countdown
            expiresAt={view.session.expiresAt}
            label="Session expires in"
            onExpire={onExpire}
            className="justify-center"
          />
          <Button onClick={onContinueFromLanding}>Continue</Button>
        </div>
      );

    case "camera":
      return <CameraCapture onContinue={onCameraContinue} onCancel={onCameraCancel} />;

    case "verifying":
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <Spinner size="lg" label="Verifying" />
          <p className="text-sm text-text-muted">Verifying your identity…</p>
          {view.session.provider === "demo" ? (
            <div className="mt-2 w-full space-y-3 rounded-md border border-dashed border-warning/50 bg-warning/5 p-4">
              <Badge tone="warning">Development only</Badge>
              <p className="text-xs text-text-muted">
                The demo provider doesn&apos;t perform real facial recognition. Use these controls
                to simulate a provider result.
              </p>
              <Button onClick={() => onCompleteDemo("success")} className="w-full">
                Complete demo verification
              </Button>
              <button
                type="button"
                onClick={() => onCompleteDemo("failure")}
                className="w-full text-xs text-text-muted underline-offset-2 hover:underline"
              >
                Simulate a failed verification
              </button>
            </div>
          ) : (
            <p className="text-xs text-text-faint">Waiting for the verification provider…</p>
          )}
        </div>
      );

    case "success":
      return (
        <SuccessState
          title="Verification complete"
          description="You can return to your computer. Your desktop will update automatically."
        />
      );

    case "failure":
      return (
        <ErrorState
          title="Verification failed"
          description="Return to your computer and start a new verification from the desktop site."
        />
      );

    default:
      return null;
  }
}
