import { VERIFYBRIDGE_CHANNEL } from "@verifybridge/shared";
import type { ContentToPageEnvelope, VerificationResult } from "@verifybridge/shared";
import type { SiteAdapter } from "./types";

const DEMO_SITE_URL = import.meta.env.WXT_PUBLIC_DEMO_SITE_URL ?? "http://localhost:5175";
const BADGE_ID = "verifybridge-badge";

export const demoSiteAdapter: SiteAdapter = {
  name: "demo-site",

  matches(location) {
    return location.origin === new URL(DEMO_SITE_URL).origin;
  },

  async detectVerificationPage() {
    return document.querySelector('[data-verifybridge="identity-verification"]') !== null;
  },

  async showVerifyBridgeOption() {
    const target = document.querySelector<HTMLElement>("[data-verifybridge-badge-target]");
    if (!target || document.getElementById(BADGE_ID)) return;

    const badge = document.createElement("span");
    badge.id = BADGE_ID;
    badge.textContent = "Secured by VerifyBridge";
    badge.setAttribute(
      "style",
      [
        "display:inline-flex",
        "align-items:center",
        "gap:4px",
        "font:500 11px/1.2 ui-sans-serif,system-ui,sans-serif",
        "color:#2563eb",
        "background:rgba(37,99,235,0.08)",
        "padding:3px 8px",
        "border-radius:999px",
      ].join(";"),
    );
    target.appendChild(badge);
  },

  async onVerificationCompleted(result: VerificationResult) {
    const envelope: ContentToPageEnvelope = {
      channel: VERIFYBRIDGE_CHANNEL,
      direction: "content-to-page",
      message: {
        type: "VERIFICATION_STATUS_CHANGED",
        sessionId: result.sessionId,
        status: result.status,
        ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      },
    };
    window.postMessage(envelope, window.location.origin);
  },
};
