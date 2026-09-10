/**
 * The lifecycle of a single verification session. Sessions are single-use,
 * short-lived transactions that only ever move forward through this
 * state machine (see `VERIFICATION_STATUS_TRANSITIONS`).
 */
export const VERIFICATION_STATUSES = [
  "CREATED",
  "MOBILE_OPENED",
  "CAMERA_GRANTED",
  "VERIFYING",
  "VERIFIED",
  "FAILED",
  "EXPIRED",
  "CONSUMED",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly VerificationStatus[] = [
  "VERIFIED",
  "FAILED",
  "EXPIRED",
  "CONSUMED",
];

export function isTerminalStatus(status: VerificationStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Allowed forward transitions. Any transition not listed here is rejected by
 * the backend, regardless of caller - this is what makes replay/out-of-order
 * status writes impossible.
 */
export const VERIFICATION_STATUS_TRANSITIONS: Readonly<
  Record<VerificationStatus, readonly VerificationStatus[]>
> = {
  CREATED: ["MOBILE_OPENED", "FAILED", "EXPIRED"],
  MOBILE_OPENED: ["CAMERA_GRANTED", "FAILED", "EXPIRED"],
  CAMERA_GRANTED: ["VERIFYING", "FAILED", "EXPIRED"],
  VERIFYING: ["VERIFIED", "FAILED", "EXPIRED"],
  VERIFIED: ["CONSUMED"],
  FAILED: [],
  EXPIRED: [],
  CONSUMED: [],
};

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return VERIFICATION_STATUS_TRANSITIONS[from].includes(to);
}
