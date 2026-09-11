import { browser, defineContentScript } from "#imports";
import type { VerificationResult } from "@verifybridge/shared";
import { findAdapterFor } from "../lib/site-adapters";
import { isExtensionResponseMessage, readPageToContentEnvelope } from "../lib/messaging/guards";

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
      void browser.runtime.sendMessage(outgoing);
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
