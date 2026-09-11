import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorState, Spinner, SuccessState } from "@verifybridge/ui";
import { onExtensionMessage, sendToExtension } from "./lib/extension-bridge";

type DemoState =
  | { kind: "idle" }
  | { kind: "waiting-for-extension" }
  | { kind: "extension-not-found" }
  | { kind: "in-progress" }
  | { kind: "verified" }
  | { kind: "failed"; reason?: string };

const EXTENSION_ACK_TIMEOUT_MS = 1500;

export default function App() {
  const [state, setState] = useState<DemoState>({ kind: "idle" });
  const ackedRef = useRef(false);

  useEffect(() => {
    return onExtensionMessage((message) => {
      ackedRef.current = true;
      if (message.type === "VERIFICATION_ERROR") {
        setState({ kind: "failed", reason: message.message });
        return;
      }
      if (message.type === "VERIFICATION_STATE") {
        if (!message.state.session) return;
        setState({ kind: "in-progress" });
        return;
      }
      if (message.type === "VERIFICATION_STATUS_CHANGED") {
        if (message.status === "VERIFIED" || message.status === "CONSUMED") {
          setState({ kind: "verified" });
        } else if (message.status === "FAILED" || message.status === "EXPIRED") {
          setState({ kind: "failed", reason: message.failureReason });
        } else {
          setState({ kind: "in-progress" });
        }
      }
    });
  }, []);

  function handleVerifyWithPhone() {
    ackedRef.current = false;
    setState({ kind: "waiting-for-extension" });
    sendToExtension({ type: "CREATE_VERIFICATION_SESSION", origin: window.location.origin });
    setTimeout(() => {
      if (!ackedRef.current) setState({ kind: "extension-not-found" });
    }, EXTENSION_ACK_TIMEOUT_MS);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <header className="text-center">
        <p className="text-lg font-semibold text-text">Acme Bank</p>
      </header>

      <Card padding="lg" data-verifybridge="identity-verification">
        <DemoBody state={state} onVerifyWithPhone={handleVerifyWithPhone} />
      </Card>

      <p className="text-center text-xs text-text-faint">
        This is a demo integration exercising the full VerifyBridge architecture end to end.
      </p>
    </div>
  );
}

function DemoBody({
  state,
  onVerifyWithPhone,
}: {
  state: DemoState;
  onVerifyWithPhone: () => void;
}) {
  if (state.kind === "verified") {
    return (
      <SuccessState
        title="Identity verified ✓"
        description="Thanks - your identity has been confirmed. You can continue."
      />
    );
  }

  if (state.kind === "failed") {
    return (
      <ErrorState
        title="Verification failed"
        description={state.reason ?? "Please try again."}
        actionLabel="Try again"
        onAction={onVerifyWithPhone}
      />
    );
  }

  if (state.kind === "extension-not-found") {
    return (
      <ErrorState
        title="VerifyBridge extension not detected"
        description="Install and enable the VerifyBridge Chrome extension, then try again."
        actionLabel="Try again"
        onAction={onVerifyWithPhone}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-text">Identity Verification</h1>
        <p className="mt-1 text-sm text-text-muted">We need to verify your identity.</p>
      </div>

      {state.kind === "in-progress" ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-canvas py-6">
          <Spinner size="lg" label="Waiting for phone verification" />
          <p className="text-sm text-text-muted">
            Check the VerifyBridge popup and continue on your phone…
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-text-muted">No webcam available?</p>
          <div data-verifybridge-badge-target className="flex flex-col items-start gap-2">
            <Button
              onClick={onVerifyWithPhone}
              loading={state.kind === "waiting-for-extension"}
              className="w-full"
            >
              Verify using phone
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
