import type { VerificationStatus } from "./status.js";

/** Public, safe-to-serialize view of a verification session. Never includes token hashes. */
export interface VerificationSessionDTO {
  id: string;
  origin: string;
  status: VerificationStatus;
  provider: string | null;
  createdAt: string;
  expiresAt: string;
  verifiedAt: string | null;
  consumedAt: string | null;
  failureReason: string | null;
}

export interface CreateVerificationSessionResponse {
  session: VerificationSessionDTO;
  /** Plaintext desktop token - returned once, never persisted or logged. */
  desktopToken: string;
  /** Fully-formed URL the QR code / "copy link" button should use. */
  mobileUrl: string;
  /** WebSocket URL (including desktop token query param) the extension should connect to. */
  wsUrl: string;
}

export interface MobileSessionView {
  origin: string;
  status: VerificationStatus;
  provider: string | null;
  expiresAt: string;
}

export interface VerificationResult {
  sessionId: string;
  status: Extract<VerificationStatus, "VERIFIED" | "FAILED">;
  verifiedAt: string | null;
  failureReason: string | null;
}
