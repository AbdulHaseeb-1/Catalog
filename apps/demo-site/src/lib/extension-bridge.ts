import { VERIFYBRIDGE_CHANNEL } from "@verifybridge/shared";
import type {
  ContentToPageEnvelope,
  ExtensionRequestMessage,
  ExtensionResponseMessage,
  PageToContentEnvelope,
} from "@verifybridge/shared";

/**
 * This is the "SDK-like helper" a real integrated site would use - it only
 * ever talks to VerifyBridge through `window.postMessage`, the same
 * boundary described in the README's message-architecture diagram. There
 * is no direct dependency on chrome.* APIs here; this code runs in the
 * ordinary page context and works identically whether or not the
 * extension happens to be installed (it just won't get a reply if not).
 */
function isContentToPageEnvelope(data: unknown): data is ContentToPageEnvelope {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).channel === VERIFYBRIDGE_CHANNEL &&
    (data as Record<string, unknown>).direction === "content-to-page"
  );
}

export function sendToExtension(message: ExtensionRequestMessage): void {
  const envelope: PageToContentEnvelope = {
    channel: VERIFYBRIDGE_CHANNEL,
    direction: "page-to-content",
    message,
  };
  window.postMessage(envelope, window.location.origin);
}

/** Returns an unsubscribe function. */
export function onExtensionMessage(callback: (message: ExtensionResponseMessage) => void): () => void {
  function handler(event: MessageEvent) {
    if (event.source !== window || !isContentToPageEnvelope(event.data)) return;
    callback(event.data.message);
  }
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
