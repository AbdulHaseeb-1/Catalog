import type { VerificationResult } from "@verifybridge/shared";

/**
 * A controlled integration layer for a specific desktop website. This is
 * the ONLY supported way a site's own verification UI gets updated
 * automatically - there is deliberately no generic DOM-scraping or
 * `getUserMedia` interception here. A site without an adapter still works
 * with VerifyBridge (the popup's manual flow always works), it just won't
 * self-update; see the "Mode 2" note in the README.
 */
export interface SiteAdapter {
  readonly name: string;

  matches(location: Location): boolean;

  /** Whether the current page is actually asking for identity verification right now. */
  detectVerificationPage(): Promise<boolean>;

  /** Optional: enhance the page's own "verify with phone" affordance. */
  showVerifyBridgeOption(): Promise<void>;

  /** Called once the desktop session this page started reaches a final state. */
  onVerificationCompleted(result: VerificationResult): Promise<void>;
}
