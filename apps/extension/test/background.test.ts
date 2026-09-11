import type { Browser } from "#imports";
import { describe, expect, it, vi } from "vitest";
import type { VerificationSessionDTO } from "@verifybridge/shared";
import { activeVerification } from "../lib/storage";

const { mockCreateSession, mockCancelSession, socketInstances } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockCancelSession: vi.fn(),
  socketInstances: [] as Array<{ opts: unknown; connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@verifybridge/verification-sdk", () => {
  class ApiClientError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  class VerificationApiClient {
    createSession = mockCreateSession;
    cancelSession = mockCancelSession;
  }
  class VerificationSocket {
    connect = vi.fn();
    close = vi.fn();
    constructor(opts: unknown) {
      socketInstances.push({ opts, connect: this.connect, close: this.close });
    }
  }
  return { ApiClientError, VerificationApiClient, VerificationSocket };
});

const { handleRequest } = await import("../entrypoints/background");

function fakeSession(overrides: Partial<VerificationSessionDTO> = {}): VerificationSessionDTO {
  return {
    id: "session-1",
    origin: "https://example.com",
    status: "CREATED",
    provider: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    verifiedAt: null,
    consumedAt: null,
    failureReason: null,
    ...overrides,
  };
}

const noSender = {} as Browser.runtime.MessageSender;

describe("background message routing", () => {
  it("returns an empty snapshot when no session is stored", async () => {
    const response = await handleRequest({ type: "GET_VERIFICATION_STATE" }, noSender);
    expect(response).toEqual({
      type: "VERIFICATION_STATE",
      state: { session: null, mobileUrl: null, error: null },
    });
  });

  it("creates a session, persists it, and opens a WebSocket", async () => {
    const session = fakeSession();
    mockCreateSession.mockResolvedValue({
      session,
      desktopToken: "desktop-token",
      mobileUrl: "http://localhost:5174/session/mobile-token",
      wsUrl: "ws://localhost:4000",
    });

    const response = await handleRequest(
      { type: "CREATE_VERIFICATION_SESSION", origin: "https://example.com" },
      noSender,
    );

    expect(response).toEqual({
      type: "VERIFICATION_STATE",
      state: {
        session,
        mobileUrl: "http://localhost:5174/session/mobile-token",
        error: null,
      },
    });
    expect(await activeVerification.getValue()).toMatchObject({
      session,
      desktopToken: "desktop-token",
    });
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0]?.connect).toHaveBeenCalledOnce();
  });

  it("surfaces a typed error when session creation fails", async () => {
    const { ApiClientError } = await import("@verifybridge/verification-sdk");
    mockCreateSession.mockRejectedValue(new ApiClientError("nope", "RATE_LIMITED", 429));

    const response = await handleRequest(
      { type: "CREATE_VERIFICATION_SESSION", origin: "https://example.com" },
      noSender,
    );

    expect(response).toEqual({ type: "VERIFICATION_ERROR", code: "RATE_LIMITED", message: "nope" });
  });

  it("cancels the active session, notifies the API, and clears local state", async () => {
    const session = fakeSession();
    await activeVerification.setValue({
      session,
      desktopToken: "desktop-token",
      mobileUrl: "http://localhost:5174/session/mobile-token",
      wsUrl: "ws://localhost:4000",
      tabId: null,
    });
    mockCancelSession.mockResolvedValue(undefined);

    const response = await handleRequest({ type: "CANCEL_VERIFICATION_SESSION" }, noSender);

    expect(mockCancelSession).toHaveBeenCalledWith("session-1", "desktop-token");
    expect(response).toEqual({
      type: "VERIFICATION_STATE",
      state: { session: null, mobileUrl: null, error: null },
    });
    expect(await activeVerification.getValue()).toBeNull();
  });

  it("clears an already-expired stored session instead of returning it", async () => {
    await activeVerification.setValue({
      session: fakeSession({ status: "MOBILE_OPENED", expiresAt: new Date(Date.now() - 1000).toISOString() }),
      desktopToken: "desktop-token",
      mobileUrl: "http://localhost:5174/session/mobile-token",
      wsUrl: "ws://localhost:4000",
      tabId: null,
    });

    const response = await handleRequest({ type: "GET_VERIFICATION_STATE" }, noSender);

    expect(response).toEqual({
      type: "VERIFICATION_STATE",
      state: { session: null, mobileUrl: null, error: null },
    });
    expect(await activeVerification.getValue()).toBeNull();
  });
});
