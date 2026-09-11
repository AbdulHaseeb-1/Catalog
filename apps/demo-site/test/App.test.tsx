import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VERIFYBRIDGE_CHANNEL } from "@verifybridge/shared";
import type { ContentToPageEnvelope } from "@verifybridge/shared";
import App from "../src/App";

function postFromExtension(message: ContentToPageEnvelope["message"]) {
  // jsdom's window.postMessage doesn't reliably set MessageEvent.source to
  // `window` for same-window delivery, which is exactly what
  // onExtensionMessage checks - dispatch the event directly instead so the
  // test exercises the real listener rather than jsdom's postMessage gap.
  const envelope: ContentToPageEnvelope = {
    channel: VERIFYBRIDGE_CHANNEL,
    direction: "content-to-page",
    message,
  };
  window.dispatchEvent(new MessageEvent("message", { data: envelope, source: window }));
}

describe("demo site", () => {
  it("marks its verification panel so the content script can detect it", () => {
    const { container } = render(<App />);
    expect(container.querySelector('[data-verifybridge="identity-verification"]')).toBeInTheDocument();
  });

  it("asks the extension to start verification when clicked", () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /verify using phone/i }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: VERIFYBRIDGE_CHANNEL,
        direction: "page-to-content",
        message: { type: "CREATE_VERIFICATION_SESSION", origin: window.location.origin },
      }),
      window.location.origin,
    );
  });

  it("shows an extension-not-found message if nothing replies in time", async () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /verify using phone/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText(/extension not detected/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows 'Identity verified' automatically once the extension confirms VERIFIED", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /verify using phone/i }));
    await act(async () => {
      postFromExtension({
        type: "VERIFICATION_STATE",
        state: { session: { id: "s1", status: "CREATED" } as never, mobileUrl: "x", error: null },
      });
    });
    expect(await screen.findByText(/waiting for phone verification/i)).toBeInTheDocument();

    await act(async () => {
      postFromExtension({ type: "VERIFICATION_STATUS_CHANGED", sessionId: "s1", status: "VERIFIED" });
    });

    expect(await screen.findByText(/identity verified/i)).toBeInTheDocument();
  });
});
