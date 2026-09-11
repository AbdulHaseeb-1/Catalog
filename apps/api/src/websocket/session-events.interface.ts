import type { VerificationStatus } from "../../generated/prisma/enums.js";

export const SESSION_EVENTS_PUBLISHER = Symbol("SESSION_EVENTS_PUBLISHER");

export interface SessionStatusChange {
  sessionId: string;
  status: VerificationStatus;
  seq: number;
  failureReason: string | null;
}

/**
 * Fan-out boundary between the session domain and however WebSocket
 * delivery is actually implemented. `VerificationService` only depends on
 * this interface, never on the gateway or Redis directly - keeps the
 * dependency graph a DAG (verification -> session-events <- websocket)
 * instead of a cycle.
 */
export interface SessionEventsPublisher {
  publish(change: SessionStatusChange): Promise<void>;
}
