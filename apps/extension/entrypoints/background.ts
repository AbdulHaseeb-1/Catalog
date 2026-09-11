import { browser, defineBackground } from "#imports";
import type { Browser } from "#imports";
import { isTerminalStatus } from "@verifybridge/shared";
import type { ExtensionRequestMessage, ExtensionResponseMessage, VerificationStateSnapshot, ServerWebSocketEvent } from "@verifybridge/shared";
import { ApiClientError, VerificationApiClient, VerificationSocket } from "@verifybridge/verification-sdk";
import { API_URL } from "../lib/config";
import { isExtensionRequestMessage } from "../lib/messaging/guards";
import { activeVerification } from "../lib/storage";
import type { StoredVerification } from "../lib/storage";

const apiClient = new VerificationApiClient({ baseUrl: API_URL });
let socket: VerificationSocket | null = null;

export default defineBackground(() => {
  // The service worker can be killed and restarted by the browser at any
  // point; re-establish the WebSocket for any still-active session as soon
  // as it wakes up, rather than waiting for the next popup open.
  void reconnectIfNeeded();

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionRequestMessage(message)) return undefined;
    handleRequest(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          type: "VERIFICATION_ERROR",
          code: "INTERNAL_ERROR",
          message: "The extension background worker hit an unexpected error.",
        } satisfies ExtensionResponseMessage),
      );
    return true; // keep the message channel open for the async sendResponse above
  });
});

function isExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now();
}

export async function reconnectIfNeeded(): Promise<void> {
  const stored = await activeVerification.getValue();
  if (!stored) return;
  if (isTerminalStatus(stored.session.status) || isExpired(stored.session.expiresAt)) {
    await activeVerification.removeValue();
    return;
  }
  connectSocket(stored);
}

export async function handleRequest(
  message: ExtensionRequestMessage,
  sender: Browser.runtime.MessageSender,
): Promise<ExtensionResponseMessage> {
  switch (message.type) {
    case "GET_VERIFICATION_STATE":
      return { type: "VERIFICATION_STATE", state: await currentSnapshot() };
    case "CREATE_VERIFICATION_SESSION":
      return createSession(message.origin, sender.tab?.id ?? (await activeTabId()));
    case "CANCEL_VERIFICATION_SESSION":
      return cancelSession();
  }
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function currentSnapshot(): Promise<VerificationStateSnapshot> {
  const stored = await activeVerification.getValue();
  if (!stored) return { session: null, mobileUrl: null, error: null };
  if (!isTerminalStatus(stored.session.status) && isExpired(stored.session.expiresAt)) {
    await activeVerification.removeValue();
    return { session: null, mobileUrl: null, error: null };
  }
  return { session: stored.session, mobileUrl: stored.mobileUrl, error: null };
}

async function createSession(
  origin: string,
  tabId: number | null,
): Promise<ExtensionResponseMessage> {
  try {
    const { session, desktopToken, mobileUrl, wsUrl } = await apiClient.createSession(origin);
    const stored: StoredVerification = { session, desktopToken, mobileUrl, wsUrl, tabId };
    await activeVerification.setValue(stored);
    connectSocket(stored);
    return { type: "VERIFICATION_STATE", state: { session, mobileUrl, error: null } };
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function cancelSession(): Promise<ExtensionResponseMessage> {
  const stored = await activeVerification.getValue();
  if (stored && !isTerminalStatus(stored.session.status)) {
    try {
      await apiClient.cancelSession(stored.session.id, stored.desktopToken);
    } catch {
      // Best-effort - still clear local state below so the popup never gets stuck.
    }
  }
  teardownSocket();
  await activeVerification.removeValue();
  return { type: "VERIFICATION_STATE", state: { session: null, mobileUrl: null, error: null } };
}

function connectSocket(stored: StoredVerification): void {
  teardownSocket();
  socket = new VerificationSocket({
    wsBaseUrl: stored.wsUrl,
    desktopToken: stored.desktopToken,
    onEvent: (event) => void handleSocketEvent(event, stored.tabId),
  });
  socket.connect();
}

function teardownSocket(): void {
  socket?.close();
  socket = null;
}

async function handleSocketEvent(event: ServerWebSocketEvent, tabId: number | null): Promise<void> {
  if (event.type !== "verification.session.updated" && event.type !== "connection.ack") return;

  const stored = await activeVerification.getValue();
  if (!stored || stored.session.id !== event.sessionId) return;

  const failureReason = "failureReason" in event ? (event.failureReason ?? null) : stored.session.failureReason;
  const updatedSession = { ...stored.session, status: event.status, failureReason };
  await activeVerification.setValue({ ...stored, session: updatedSession });

  const outgoing: ExtensionResponseMessage = {
    type: "VERIFICATION_STATUS_CHANGED",
    sessionId: updatedSession.id,
    status: updatedSession.status,
    ...(failureReason ? { failureReason } : {}),
  };

  // Both sends are best-effort: the popup usually isn't open, and the tab
  // may have navigated away or have no content script - neither is an error.
  browser.runtime.sendMessage(outgoing).catch(() => {});
  if (tabId != null) browser.tabs.sendMessage(tabId, outgoing).catch(() => {});

  if (updatedSession.status === "VERIFIED") {
    void browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      title: "Verification complete",
      message: "Your identity was verified. Return to your computer to continue.",
    });
  }
  if (isTerminalStatus(updatedSession.status)) teardownSocket();
}

function toErrorResponse(error: unknown): ExtensionResponseMessage {
  if (error instanceof ApiClientError) {
    return { type: "VERIFICATION_ERROR", code: error.code, message: error.message };
  }
  return {
    type: "VERIFICATION_ERROR",
    code: "INTERNAL_ERROR",
    message: "Could not reach the VerifyBridge server.",
  };
}
