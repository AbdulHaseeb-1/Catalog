import { storage } from "#imports";
import type { VerificationSessionDTO } from "@verifybridge/shared";

export interface StoredVerification {
  session: VerificationSessionDTO;
  desktopToken: string;
  mobileUrl: string;
  wsUrl: string;
  /** The tab that requested this session, so results can be routed back to it. */
  tabId: number | null;
}

/**
 * `session:` (not `local:`) - this is transaction state for one in-flight
 * verification, not a user preference, and should not survive a full
 * browser restart. `chrome.storage.session` also isn't synced or exposed
 * to content scripts by default, which fits data that includes a live
 * session token.
 */
export const activeVerification = storage.defineItem<StoredVerification | null>(
  "session:activeVerification",
  { fallback: null },
);
