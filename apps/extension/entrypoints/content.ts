import { browser, defineContentScript } from "#imports";
import { VERIFYBRIDGE_CHANNEL } from "@verifybridge/shared";
import type { ContentToPageEnvelope, VerificationResult } from "@verifybridge/shared";
import { findAdapterFor } from "../lib/site-adapters";
import { isExtensionResponseMessage, readPageToContentEnvelope } from "../lib/messaging/guards";

function postToPage(message: ContentToPageEnvelope["message"]): void {
  const envelope: ContentToPageEnvelope = {
    channel: VERIFYBRIDGE_CHANNEL,
    direction: "content-to-page",
    message,
  };
  window.postMessage(envelope, window.location.origin);
}

export default defineContentScript({
  // Dev demo site. Add your integrated site's origin(s) here (and a
  // matching SiteAdapter in lib/site-adapters) to support it too.
  matches: ["http://localhost:5175/*"],
  async main() {
    const adapter = findAdapterFor(window.location);
    if (adapter && (await adapter.detectVerificationPage())) {
      await adapter.showVerifyBridgeOption();
    }

    // Untrusted boundary: any script on this page can call
    // window.postMessage. readPageToContentEnvelope only accepts messages
    // that carry our channel marker and match a known request shape.
    window.addEventListener("message", (event) => {
      const message = readPageToContentEnvelope(event);
      if (!message) return;

      const outgoing =
        message.type === "CREATE_VERIFICATION_SESSION"
          ? { ...message, origin: window.location.origin } // never trust a page-supplied origin
          : message;
      // Relay the background's direct response back to the page (e.g. the
      // initial CREATED status right after a CREATE_VERIFICATION_SESSION
      // request) - this is also how a page detects the extension is
      // actually installed and listening, vs. silently doing nothing.
      browser.runtime
        .sendMessage(outgoing)
        .then((response: unknown) => {
          if (isExtensionResponseMessage(response)) postToPage(response);
        })
        .catch(() => {});
    });

    browser.runtime.onMessage.addListener((message) => {
      if (!isExtensionResponseMessage(message) || message.type !== "VERIFICATION_STATUS_CHANGED") {
        return;
      }
      if (message.status !== "VERIFIED" && message.status !== "FAILED") return;
      if (!adapter) return;

      const result: VerificationResult = {
        sessionId: message.sessionId,
        status: message.status,
        verifiedAt: message.status === "VERIFIED" ? new Date().toISOString() : null,
        failureReason: message.failureReason ?? null,
      };
      void adapter.onVerificationCompleted(result);
    });
  },
});
