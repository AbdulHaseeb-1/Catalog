import type { MobileSessionView, VerificationSessionDTO } from "@verifybridge/shared";
import type { VerificationSessionModel } from "../../generated/prisma/models.js";

export function toSessionDTO(session: VerificationSessionModel): VerificationSessionDTO {
  return {
    id: session.id,
    origin: session.origin,
    status: session.status,
    provider: session.provider,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    verifiedAt: session.verifiedAt ? session.verifiedAt.toISOString() : null,
    consumedAt: session.consumedAt ? session.consumedAt.toISOString() : null,
    failureReason: session.failureReason,
  };
}

export function toMobileView(session: VerificationSessionModel): MobileSessionView {
  return {
    origin: session.origin,
    status: session.status,
    provider: session.provider,
    expiresAt: session.expiresAt.toISOString(),
  };
}
