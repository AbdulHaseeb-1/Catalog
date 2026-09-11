import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationSocket } from "../src/websocket-client.js";

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  simulateMessage(data: unknown) {
    this.emit("message", { data: JSON.stringify(data) });
  }
}

describe("VerificationSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the ws path with the desktop token as a query param", () => {
    const onEvent = vi.fn();
    const socket = new VerificationSocket({
      wsBaseUrl: "http://localhost:4000",
      desktopToken: "desktop-token",
      onEvent,
    });

    socket.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const url = new URL(FakeWebSocket.instances[0]!.url);
    expect(url.protocol).toBe("ws:");
    expect(url.pathname).toBe("/ws/verification");
    expect(url.searchParams.get("token")).toBe("desktop-token");
  });

  it("delivers events with increasing seq and drops stale replays", () => {
    const onEvent = vi.fn();
    const socket = new VerificationSocket({
      wsBaseUrl: "http://localhost:4000",
      desktopToken: "tok",
      onEvent,
    });
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "connection.ack", sessionId: "s1", status: "CREATED", seq: 1 });
    ws.simulateMessage({
      type: "verification.session.updated",
      sessionId: "s1",
      status: "MOBILE_OPENED",
      seq: 2,
      occurredAt: new Date().toISOString(),
    });
    // Stale/duplicate event - must be dropped.
    ws.simulateMessage({
      type: "verification.session.updated",
      sessionId: "s1",
      status: "MOBILE_OPENED",
      seq: 2,
      occurredAt: new Date().toISOString(),
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("reconnects with backoff after an unexpected close, but not after close()", () => {
    const socket = new VerificationSocket({
      wsBaseUrl: "http://localhost:4000",
      desktopToken: "tok",
      onEvent: vi.fn(),
    });
    socket.connect();
    FakeWebSocket.instances[0]!.simulateOpen();
    FakeWebSocket.instances[0]!.close();

    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    const countBeforeExplicitClose = FakeWebSocket.instances.length;
    socket.close();
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances.length).toBe(countBeforeExplicitClose);
  });
});
