import type { VerificationStatus } from "./status.js";

/**
 * Sent once, immediately after the server accepts a desktop WebSocket
 * connection. Carries the session's current status/seq so a client that
 * reconnects mid-flow (e.g. after a service-worker restart) can resync
 * without replaying the full event log.
 */
export interface ConnectionAckEvent {
  type: "connection.ack";
  sessionId: string;
  status: VerificationStatus;
  seq: number;
}

/**
 * Emitted every time a session's status changes. `seq` is a per-session
 * monotonically increasing counter so clients can detect gaps/out-of-order
 * delivery after a reconnect and simply keep the highest-seq status they've
 * seen.
 */
export interface SessionUpdatedEvent {
  type: "verification.session.updated";
  sessionId: string;
  status: VerificationStatus;
  seq: number;
  occurredAt: string;
  failureReason?: string;
}

export interface PongEvent {
  type: "pong";
}

export interface ServerErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type ServerWebSocketEvent =
  | ConnectionAckEvent
  | SessionUpdatedEvent
  | PongEvent
  | ServerErrorEvent;
