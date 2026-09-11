import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { browser } from "#imports";
import type { VerificationSessionDTO } from "@verifybridge/shared";

const { sendToBackground, getActiveTabOrigin } = vi.hoisted(() => ({
  sendToBackground: vi.fn(),
  getActiveTabOrigin: vi.fn(),
}));

vi.mock("../lib/messaging/client", () => ({ sendToBackground, getActiveTabOrigin }));

const { default: App } = await import("../entrypoints/popup/App");

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

describe("popup", () => {
  it("shows the idle state when no session is active", async () => {
    sendToBackground.mockResolvedValue({
      type: "VERIFICATION_STATE",
      state: { session: null, mobileUrl: null, error: null },
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /verify using phone/i })).toBeInTheDocument();
  });

  it("shows the QR code and status once a session is active", async () => {
    sendToBackground.mockResolvedValue({
      type: "VERIFICATION_STATE",
      state: {
        session: fakeSession(),
        mobileUrl: "http://localhost:5174/session/mobile-token",
        error: null,
      },
    });

    render(<App />);

    expect(await screen.findByText("Waiting for phone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("starts a session when 'Verify using phone' is clicked", async () => {
    sendToBackground.mockResolvedValueOnce({
      type: "VERIFICATION_STATE",
      state: { session: null, mobileUrl: null, error: null },
    });
    getActiveTabOrigin.mockResolvedValue("https://example.com");
    sendToBackground.mockResolvedValueOnce({
      type: "VERIFICATION_STATE",
      state: {
        session: fakeSession(),
        mobileUrl: "http://localhost:5174/session/mobile-token",
        error: null,
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /verify using phone/i }));

    expect(sendToBackground).toHaveBeenCalledWith({
      type: "CREATE_VERIFICATION_SESSION",
      origin: "https://example.com",
    });
    expect(await screen.findByText("Waiting for phone")).toBeInTheDocument();
  });

  it("updates live when the background broadcasts a status change", async () => {
    sendToBackground.mockResolvedValue({
      type: "VERIFICATION_STATE",
      state: {
        session: fakeSession(),
        mobileUrl: "http://localhost:5174/session/mobile-token",
        error: null,
      },
    });

    render(<App />);
    await screen.findByText("Waiting for phone");

    await act(async () => {
      await browser.runtime.sendMessage({
        type: "VERIFICATION_STATUS_CHANGED",
        sessionId: "session-1",
        status: "VERIFIED",
      });
    });

    expect(await screen.findByText(/verification complete/i)).toBeInTheDocument();
  });
});
