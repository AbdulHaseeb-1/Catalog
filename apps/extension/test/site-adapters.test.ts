import { afterEach, describe, expect, it } from "vitest";
import { demoSiteAdapter } from "../lib/site-adapters/demo-site.adapter";
import { findAdapterFor } from "../lib/site-adapters";

describe("demoSiteAdapter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("matches only the configured demo site origin", () => {
    expect(demoSiteAdapter.matches(new URL("http://localhost:5175/") as unknown as Location)).toBe(
      true,
    );
    expect(
      demoSiteAdapter.matches(new URL("https://not-the-demo-site.com/") as unknown as Location),
    ).toBe(false);
  });

  it("detects the verification page via its data attribute", async () => {
    document.body.innerHTML = '<div data-verifybridge="identity-verification"></div>';
    expect(await demoSiteAdapter.detectVerificationPage()).toBe(true);

    document.body.innerHTML = "<div>no marker here</div>";
    expect(await demoSiteAdapter.detectVerificationPage()).toBe(false);
  });

  it("injects a badge into the page's designated target, once", async () => {
    document.body.innerHTML = '<div data-verifybridge-badge-target></div>';
    await demoSiteAdapter.showVerifyBridgeOption();
    await demoSiteAdapter.showVerifyBridgeOption();

    expect(document.querySelectorAll("#verifybridge-badge")).toHaveLength(1);
  });

  it("does nothing when the page has no badge target", async () => {
    document.body.innerHTML = "<div></div>";
    await expect(demoSiteAdapter.showVerifyBridgeOption()).resolves.toBeUndefined();
  });

  it("notifies the page via postMessage on completion", async () => {
    const received = new Promise((resolve) => {
      window.addEventListener("message", resolve, { once: true });
    });

    await demoSiteAdapter.onVerificationCompleted({
      sessionId: "s1",
      status: "VERIFIED",
      verifiedAt: new Date().toISOString(),
      failureReason: null,
    });

    const event = (await received) as MessageEvent;
    expect(event.data).toMatchObject({
      channel: "verifybridge",
      direction: "content-to-page",
      message: { type: "VERIFICATION_STATUS_CHANGED", sessionId: "s1", status: "VERIFIED" },
    });
  });
});

describe("findAdapterFor", () => {
  it("returns the demo adapter for the demo site origin", () => {
    const adapter = findAdapterFor(new URL("http://localhost:5175/anything") as unknown as Location);
    expect(adapter?.name).toBe("demo-site");
  });

  it("returns undefined for an unrecognized origin", () => {
    expect(findAdapterFor(new URL("https://random-site.example") as unknown as Location)).toBeUndefined();
  });
});
