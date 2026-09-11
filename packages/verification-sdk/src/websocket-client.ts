import { WS_PATH } from "@verifybridge/shared";
import type { ServerWebSocketEvent } from "@verifybridge/shared";

function isServerWebSocketEvent(value: unknown): value is ServerWebSocketEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

export interface VerificationSocketOptions {
  /** e.g. "ws://localhost:4000" or "wss://api.verifybridge.example" - no path/query. */
  wsBaseUrl: string;
  desktopToken: string;
  onEvent: (event: ServerWebSocketEvent) => void;
  onConnectionStateChange?: (state: "connecting" | "open" | "closed") => void;
  heartbeatIntervalMs?: number;
  maxReconnectDelayMs?: number;
}

/**
 * Reconnecting WebSocket client for the desktop side of a verification
 * session. Used by the Chrome extension's background service worker, which
 * can be suspended and restarted by the browser at any time - `connect()`
 * is always safe to call again and will tear down any previous socket.
 */
export class VerificationSocket {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByCaller = false;
  private lastSeq = 0;

  constructor(private readonly options: VerificationSocketOptions) {}

  connect(): void {
    this.closedByCaller = false;
    this.teardownSocket();

    const url = new URL(WS_PATH, this.options.wsBaseUrl.replace(/^http/, "ws"));
    url.searchParams.set("token", this.options.desktopToken);

    this.options.onConnectionStateChange?.("connecting");
    const socket = new WebSocket(url.toString());
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.options.onConnectionStateChange?.("open");
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isServerWebSocketEvent(parsed)) return;
      if ("seq" in parsed && typeof parsed.seq === "number") {
        if (parsed.seq <= this.lastSeq && parsed.type !== "connection.ack") return;
        this.lastSeq = Math.max(this.lastSeq, parsed.seq);
      }
      this.options.onEvent(parsed);
    });

    socket.addEventListener("close", () => {
      this.stopHeartbeat();
      this.options.onConnectionStateChange?.("closed");
      if (!this.closedByCaller) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.teardownSocket();
  }

  private teardownSocket(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = this.options.heartbeatIntervalMs ?? 25_000;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "ping" }));
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const maxDelay = this.options.maxReconnectDelayMs ?? 15_000;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, maxDelay);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.closedByCaller) this.connect();
    }, delay);
  }
}
