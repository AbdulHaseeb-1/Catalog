import type {
  ExtensionRequestMessage,
  ExtensionResponseMessage,
  PageToContentEnvelope,
} from "@verifybridge/shared";
import { VERIFYBRIDGE_CHANNEL } from "@verifybridge/shared";

/**
 * Runtime guards for every message that crosses a trust boundary
 * (untrusted webpage -> content script, content script/popup -> background
 * and back). Nothing here is assumed well-formed just because TypeScript
 * says so on the sending side - a compromised or unrelated script in the
 * page, or a stale message from a previous extension version, is still
 * possible input.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isExtensionRequestMessage(value: unknown): value is ExtensionRequestMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "CREATE_VERIFICATION_SESSION":
      return typeof value.origin === "string" && value.origin.length > 0;
    case "CANCEL_VERIFICATION_SESSION":
    case "GET_VERIFICATION_STATE":
      return true;
    default:
      return false;
  }
}

export function isExtensionResponseMessage(value: unknown): value is ExtensionResponseMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "VERIFICATION_STATE":
      return isRecord(value.state);
    case "VERIFICATION_STATUS_CHANGED":
      return typeof value.sessionId === "string" && typeof value.status === "string";
    case "VERIFICATION_ERROR":
      return typeof value.code === "string" && typeof value.message === "string";
    default:
      return false;
  }
}

/**
 * A page can only ever reach the extension through `window.postMessage`,
 * which any script on that page (not just the one we expect) can send. We
 * only act on messages that: came from the same window (not an iframe or
 * another origin), carry our channel marker, and pass the request-message
 * shape check above.
 */
export function readPageToContentEnvelope(
  event: MessageEvent,
): PageToContentEnvelope["message"] | null {
  if (event.source !== window) return null;
  const data = event.data;
  if (
    !isRecord(data) ||
    data.channel !== VERIFYBRIDGE_CHANNEL ||
    data.direction !== "page-to-content"
  ) {
    return null;
  }
  return isExtensionRequestMessage(data.message) ? data.message : null;
}
