import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptAppRedirect, isMobileOs } from "../src/lib/app-redirect";

describe("isMobileOs", () => {
  it("recognizes iOS and Android user agents", () => {
    expect(isMobileOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isMobileOs("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isMobileOs("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(true);
  });

  it("does not recognize desktop user agents", () => {
    expect(isMobileOs("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0")).toBe(
      false,
    );
    expect(isMobileOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(
      false,
    );
    expect(isMobileOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")).toBe(false);
  });
});

function makeFakeDom(initialVisibility: DocumentVisibilityState = "visible") {
  const listeners = new Set<() => void>();
  let visibilityState = initialVisibility;

  const fakeDocument = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "visibilitychange") listeners.add(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "visibilitychange") listeners.delete(handler);
    }),
  };

  function setVisibility(next: DocumentVisibilityState) {
    visibilityState = next;
    for (const listener of listeners) listener();
  }

  const fakeWindow = { setTimeout, clearTimeout };
  const fakeLocation = { href: "" };

  return {
    fakeDocument,
    fakeWindow,
    fakeLocation,
    setVisibility,
    listenerCount: () => listeners.size,
  };
}

describe("attemptAppRedirect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("navigates to the custom-scheme session URL", () => {
    const { fakeDocument, fakeWindow, fakeLocation } = makeFakeDom();
    attemptAppRedirect("tok123", vi.fn(), {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
    });
    expect(fakeLocation.href).toBe("verifybridge://session/tok123");
  });

  it("falls back after the timeout if the page never leaves the foreground", () => {
    const { fakeDocument, fakeWindow, fakeLocation } = makeFakeDom();
    const onFallback = vi.fn();
    attemptAppRedirect("tok123", onFallback, {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
      timeoutMs: 1000,
    });

    expect(onFallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(onFallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("does not fall back if the page is backgrounded before the timeout (app opened)", () => {
    const { fakeDocument, fakeWindow, fakeLocation, setVisibility } = makeFakeDom();
    const onFallback = vi.fn();
    attemptAppRedirect("tok123", onFallback, {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(200);
    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back once the user returns to the tab after the app took over", () => {
    const { fakeDocument, fakeWindow, fakeLocation, setVisibility } = makeFakeDom();
    const onFallback = vi.fn();
    attemptAppRedirect("tok123", onFallback, {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(200);
    setVisibility("hidden");
    setVisibility("visible");
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("never calls onFallback twice", () => {
    const { fakeDocument, fakeWindow, fakeLocation, setVisibility } = makeFakeDom();
    const onFallback = vi.fn();
    attemptAppRedirect("tok123", onFallback, {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(200);
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    setVisibility("visible");
    vi.advanceTimersByTime(5000);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents onFallback from ever firing", () => {
    const { fakeDocument, fakeWindow, fakeLocation } = makeFakeDom();
    const onFallback = vi.fn();
    const controller = attemptAppRedirect("tok123", onFallback, {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
      timeoutMs: 1000,
    });

    controller.cancel();
    vi.advanceTimersByTime(5000);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("removes its visibility listener once resolved via timeout", () => {
    const { fakeDocument, fakeWindow, fakeLocation, listenerCount } = makeFakeDom();
    attemptAppRedirect("tok123", vi.fn(), {
      document: fakeDocument,
      window: fakeWindow,
      location: fakeLocation,
      timeoutMs: 1000,
    });

    expect(listenerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(listenerCount()).toBe(0);
  });
});
