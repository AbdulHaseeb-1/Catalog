import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@verifybridge/verification-sdk";
import type { MobileSessionView } from "@verifybridge/shared";

const { apiClient } = vi.hoisted(() => ({
  apiClient: {
    getMobileSession: vi.fn(),
    startMobileVerification: vi.fn(),
    completeDemoVerification: vi.fn(),
  },
}));

vi.mock("../src/lib/api-client", () => ({ apiClient }));

// Imported after the mock so App picks up the mocked client.
const { default: App } = await import("../src/App");

function setPath(path: string) {
  window.history.pushState(null, "", path);
}

function session(overrides: Partial<MobileSessionView> = {}): MobileSessionView {
  return {
    origin: "https://example.com",
    status: "CREATED",
    provider: null,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("VerifyBridge mobile app", () => {
  beforeEach(() => {
    setPath("/session/test-token");
    vi.clearAllMocks();
  });

  afterEach(() => {
    // @ts-expect-error - test-only cleanup of a property we defined
    delete navigator.mediaDevices;
  });

  it("shows an error for a URL that isn't a verification link", async () => {
    setPath("/not-a-session-link");
    render(<App />);
    expect(await screen.findByText(/isn't a valid verification link/i)).toBeInTheDocument();
    expect(apiClient.getMobileSession).not.toHaveBeenCalled();
  });

  it("shows an expired message when the session has expired", async () => {
    apiClient.getMobileSession.mockRejectedValue(
      new ApiClientError("expired", "SESSION_EXPIRED", 410),
    );
    render(<App />);
    expect(await screen.findByText(/this link has expired/i)).toBeInTheDocument();
  });

  it("shows an error state when camera permission is denied", async () => {
    apiClient.getMobileSession.mockResolvedValue(session());
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Allow Camera" }));

    expect(await screen.findByText(/camera access was denied/i)).toBeInTheDocument();
  });

  it("completes the demo verification success path end to end", async () => {
    apiClient.getMobileSession.mockResolvedValue(session());
    apiClient.startMobileVerification.mockResolvedValue(
      session({ status: "VERIFYING", provider: "demo" }),
    );
    apiClient.completeDemoVerification.mockResolvedValue(
      session({ status: "VERIFIED", provider: "demo" }),
    );
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Allow Camera" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));

    expect(apiClient.startMobileVerification).toHaveBeenCalledWith("test-token");
    await userEvent.click(
      await screen.findByRole("button", { name: /complete demo verification/i }),
    );

    expect(apiClient.completeDemoVerification).toHaveBeenCalledWith("test-token", "success");
    expect(await screen.findByText(/verification complete/i)).toBeInTheDocument();
  });

  it("shows the failure screen when the demo verification is simulated to fail", async () => {
    apiClient.getMobileSession.mockResolvedValue(session());
    apiClient.startMobileVerification.mockResolvedValue(
      session({ status: "VERIFYING", provider: "demo" }),
    );
    apiClient.completeDemoVerification.mockResolvedValue(
      session({ status: "FAILED", provider: "demo" }),
    );
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Allow Camera" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: /simulate a failed/i }));

    expect(apiClient.completeDemoVerification).toHaveBeenCalledWith("test-token", "failure");
    await waitFor(() => expect(screen.getByText(/verification failed/i)).toBeInTheDocument());
  });
});
