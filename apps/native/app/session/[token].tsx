import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { MobileSessionView } from "@verifybridge/shared";
import { ApiClientError } from "@verifybridge/verification-sdk";
import { Countdown } from "../../components/Countdown.js";
import { FaceScanCamera } from "../../components/FaceScanCamera.js";
import { apiClient } from "../../lib/api-client.js";

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

function viewForSession(session: MobileSessionView): ViewState {
  if (session.status === "VERIFIED" || session.status === "CONSUMED") return { kind: "success" };
  if (session.status === "FAILED") return { kind: "failure" };
  if (session.status === "VERIFYING" || session.status === "CAMERA_GRANTED") {
    return { kind: "verifying", session };
  }
  return { kind: "landing", session };
}

export default function SessionScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = useMemo(
    () => (typeof params.token === "string" ? params.token : null),
    [params.token],
  );
  const [view, setView] = useState<ViewState>(() =>
    token ? { kind: "loading" } : { kind: "invalid-link" },
  );

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

  function handleContinueFromLanding() {
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
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.card}>
        <ViewBody
          view={view}
          onContinueFromLanding={handleContinueFromLanding}
          onCameraContinue={handleCameraContinue}
          onCameraCancel={handleCameraCancel}
          onCompleteDemo={handleCompleteDemo}
          onExpire={() => setView({ kind: "expired" })}
        />
      </View>
    </ScrollView>
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
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.body}>Loading verification session…</Text>
        </View>
      );

    case "invalid-link":
      return (
        <ErrorBlock
          title="This isn't a valid verification link"
          description="Ask the desktop site to generate a new QR code or link, then try again."
        />
      );

    case "expired":
      return (
        <ErrorBlock
          title="This link has expired"
          description="Verification links are valid for a few minutes. Go back to your computer and start again."
        />
      );

    case "error":
      return <ErrorBlock title="Something went wrong" description={view.message} />;

    case "landing":
      return (
        <View style={styles.gap}>
          <Text style={styles.title}>Verify your identity</Text>
          <Text style={styles.body}>
            You&apos;re securely continuing verification from your desktop.
          </Text>
          <View style={styles.originBox}>
            <Text style={styles.originLabel}>Website</Text>
            <Text style={styles.originValue}>{view.session.origin}</Text>
          </View>
          <Countdown
            expiresAt={view.session.expiresAt}
            label="Session expires in"
            onExpire={onExpire}
          />
          <Pressable style={styles.primaryButton} onPress={onContinueFromLanding}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
        </View>
      );

    case "camera":
      return <FaceScanCamera onContinue={onCameraContinue} onCancel={onCameraCancel} />;

    case "verifying":
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.body}>Verifying your identity…</Text>
          {view.session.provider === "demo" ? (
            <View style={styles.devBox}>
              <Text style={styles.devBadge}>DEVELOPMENT ONLY</Text>
              <Text style={styles.devText}>
                The demo provider doesn&apos;t perform real facial recognition. Use these controls
                to simulate a provider result.
              </Text>
              <Pressable style={styles.primaryButton} onPress={() => onCompleteDemo("success")}>
                <Text style={styles.primaryButtonText}>Complete demo verification</Text>
              </Pressable>
              <Pressable onPress={() => onCompleteDemo("failure")}>
                <Text style={styles.linkText}>Simulate a failed verification</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.faint}>Waiting for the verification provider…</Text>
          )}
        </View>
      );

    case "success":
      return (
        <View style={styles.centered}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.title}>Verification complete</Text>
          <Text style={styles.body}>
            You can return to your computer. Your desktop will update automatically.
          </Text>
        </View>
      );

    case "failure":
      return (
        <ErrorBlock
          title="Verification failed"
          description="Return to your computer and start a new verification from the desktop site."
        />
      );

    default:
      return null;
  }
}

function ErrorBlock({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.errorIcon}>!</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  centered: { alignItems: "center", gap: 10 },
  gap: { gap: 14 },
  title: { fontSize: 18, fontWeight: "600", color: "#111827", textAlign: "center" },
  body: { fontSize: 14, color: "#4B5563", textAlign: "center" },
  faint: { fontSize: 12, color: "#9CA3AF", textAlign: "center" },
  originBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  originLabel: { fontSize: 12, color: "#9CA3AF" },
  originValue: { fontSize: 14, fontWeight: "500", color: "#111827" },
  primaryButton: {
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
  linkText: {
    color: "#4B5563",
    fontSize: 13,
    textDecorationLine: "underline",
    textAlign: "center",
  },
  devBox: {
    marginTop: 8,
    width: "100%",
    gap: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D97706",
    backgroundColor: "#FFFBEB",
    borderRadius: 10,
    padding: 14,
  },
  devBadge: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "700",
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  devText: { fontSize: 12, color: "#78716C" },
  successIcon: { fontSize: 40, color: "#16A34A" },
  errorIcon: { fontSize: 32, color: "#DC2626", fontWeight: "700" },
});
