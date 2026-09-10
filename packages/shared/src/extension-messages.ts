import type { VerificationStatus } from "./status.js";
import type { VerificationSessionDTO } from "./dto.js";

/**
 * Messages a popup or content script can send to the background service
 * worker. `origin` on CREATE_VERIFICATION_SESSION is always taken from
 * `location.origin` of the tab that asked (or the active tab, for the
 * popup's manual flow) - never trusted from arbitrary page input.
 */
export type ExtensionRequestMessage =
  | { type: "CREATE_VERIFICATION_SESSION"; origin: string }
  | { type: "CANCEL_VERIFICATION_SESSION" }
  | { type: "GET_VERIFICATION_STATE" };

export interface VerificationStateSnapshot {
  session: VerificationSessionDTO | null;
  mobileUrl: string | null;
  error: { code: string; message: string } | null;
}

/** Messages the background service worker sends back to a popup or content script. */
export type ExtensionResponseMessage =
  | { type: "VERIFICATION_STATE"; state: VerificationStateSnapshot }
  | {
      type: "VERIFICATION_STATUS_CHANGED";
      sessionId: string;
      status: VerificationStatus;
      failureReason?: string;
    }
  | { type: "VERIFICATION_ERROR"; code: string; message: string };

export type ExtensionMessage = ExtensionRequestMessage | ExtensionResponseMessage;

/**
 * Envelope used for the (untrusted) webpage <-> content script boundary via
 * `window.postMessage`. The content script only ever acts on messages where
 * `event.source === window` and `channel === "verifybridge"` - anything else
 * is ignored. A page can only ever request a session for its own origin, so
 * there is no privilege a malicious page gains beyond what it could already
 * do by asking the user to click the extension's own popup.
 */
export const VERIFYBRIDGE_CHANNEL = "verifybridge" as const;

export interface PageToContentEnvelope {
  channel: typeof VERIFYBRIDGE_CHANNEL;
  direction: "page-to-content";
  message: ExtensionRequestMessage;
}

export interface ContentToPageEnvelope {
  channel: typeof VERIFYBRIDGE_CHANNEL;
  direction: "content-to-page";
  message: ExtensionResponseMessage;
}
