import { useEffect, useState } from "react";
import { browser } from "#imports";
import type { VerificationSessionDTO } from "@verifybridge/shared";
import {
  Badge,
  Button,
  Card,
  Countdown,
  ErrorState,
  QRCodeCard,
  Spinner,
  StatusIndicator,
  SuccessState,
} from "@verifybridge/ui";
import { getActiveTabOrigin, sendToBackground } from "../../lib/messaging/client";
import { isExtensionResponseMessage } from "../../lib/messaging/guards";

type PopupState =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "no-tab" }
  | { kind: "creating" }
  | { kind: "active"; session: VerificationSessionDTO; mobileUrl: string }
  | { kind: "error"; message: string };

export default function App() {
  const [state, setState] = useState<PopupState>({ kind: "loading" });

  useEffect(() => {
    sendToBackground({ type: "GET_VERIFICATION_STATE" }).then((response) => {
      if (response.type !== "VERIFICATION_STATE") return;
      setState(
        response.state.session && response.state.mobileUrl
          ? { kind: "active", session: response.state.session, mobileUrl: response.state.mobileUrl }
          : { kind: "idle" },
      );
    });

    function onMessage(message: unknown) {
      if (!isExtensionResponseMessage(message) || message.type !== "VERIFICATION_STATUS_CHANGED") {
        return;
      }
      setState((prev) => {
        if (prev.kind !== "active") return prev;
        return {
          ...prev,
          session: {
            ...prev.session,
            status: message.status,
            failureReason: message.failureReason ?? prev.session.failureReason,
          },
        };
      });
    }
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function handleStart() {
    setState({ kind: "creating" });
    const origin = await getActiveTabOrigin();
    if (!origin) {
      setState({ kind: "no-tab" });
      return;
    }
    const response = await sendToBackground({ type: "CREATE_VERIFICATION_SESSION", origin });
    if (response.type === "VERIFICATION_STATE" && response.state.session && response.state.mobileUrl) {
      setState({ kind: "active", session: response.state.session, mobileUrl: response.state.mobileUrl });
    } else if (response.type === "VERIFICATION_ERROR") {
      setState({ kind: "error", message: response.message });
    }
  }

  async function handleReset() {
    await sendToBackground({ type: "CANCEL_VERIFICATION_SESSION" });
    setState({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-4 bg-canvas p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-text">VerifyBridge</h1>
        {state.kind === "active" ? (
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-accent motion-safe:animate-pulse"
          />
        ) : null}
      </header>

      <Card padding="lg">
        <PopupBody state={state} onStart={handleStart} onReset={handleReset} />
      </Card>
    </div>
  );
}

interface PopupBodyProps {
  state: PopupState;
  onStart: () => void;
  onReset: () => void;
}

function PopupBody({ state, onStart, onReset }: PopupBodyProps) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="flex justify-center py-6">
          <Spinner label="Loading" />
        </div>
      );

    case "idle":
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-text-muted">Use your phone for verification</p>
          <Button onClick={onStart} className="w-full">
            Verify using phone
          </Button>
          <p className="text-xs text-text-faint">
            Automatic completion requires a supported site integration. Otherwise, complete
            verification on your phone and return here manually.
          </p>
        </div>
      );

    case "no-tab":
      return (
        <ErrorState
          title="No active tab"
          description="Open the site that needs verification, then try again."
          actionLabel="Try again"
          onAction={onStart}
        />
      );

    case "creating":
      return (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner size="lg" label="Creating verification session" />
          <p className="text-sm text-text-muted">Preparing your session…</p>
        </div>
      );

    case "error":
      return (
        <ErrorState title="Couldn't start verification" description={state.message} actionLabel="Try again" onAction={onStart} />
      );

    case "active":
      return <ActiveSession session={state.session} mobileUrl={state.mobileUrl} onCancel={onReset} onDone={onReset} />;

    default:
      return null;
  }
}

function ActiveSession({
  session,
  mobileUrl,
  onCancel,
  onDone,
}: {
  session: VerificationSessionDTO;
  mobileUrl: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  if (session.status === "VERIFIED" || session.status === "CONSUMED") {
    return (
      <SuccessState
        title="Verification complete"
        description={
          <>
            Your identity was verified using your phone.
            <br />
            Desktop verification can now continue.
          </>
        }
        actionLabel="Done"
        onAction={onDone}
      />
    );
  }

  if (session.status === "FAILED") {
    return (
      <ErrorState
        title="Verification failed"
        description={session.failureReason ?? "Please try again from the desktop site."}
        actionLabel="Done"
        onAction={onDone}
      />
    );
  }

  if (session.status === "EXPIRED") {
    return (
      <ErrorState
        title="Link expired"
        description="Start a new verification to get a fresh QR code."
        actionLabel="Done"
        onAction={onDone}
      />
    );
  }

  const shortLink = mobileUrl.replace(/^https?:\/\//, "");

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-center text-sm text-text-muted">Scan with your phone to continue</p>
      <QRCodeCard url={mobileUrl} displayText={shortLink} />
      <div className="flex w-full items-center justify-between pt-1">
        <StatusIndicator status={session.status} />
        <Countdown expiresAt={session.expiresAt} label="Expires in" />
      </div>
      <Badge tone="neutral" className="self-start">
        {session.origin}
      </Badge>
      <Button variant="secondary" onClick={onCancel} className="mt-2 w-full">
        Cancel
      </Button>
    </div>
  );
}
