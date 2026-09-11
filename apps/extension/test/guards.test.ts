import { describe, expect, it } from "vitest";
import {
  isExtensionRequestMessage,
  isExtensionResponseMessage,
  readPageToContentEnvelope,
} from "../lib/messaging/guards";

describe("isExtensionRequestMessage", () => {
  it("accepts well-formed request messages", () => {
    expect(
      isExtensionRequestMessage({ type: "CREATE_VERIFICATION_SESSION", origin: "https://a.com" }),
    ).toBe(true);
    expect(isExtensionRequestMessage({ type: "CANCEL_VERIFICATION_SESSION" })).toBe(true);
    expect(isExtensionRequestMessage({ type: "GET_VERIFICATION_STATE" })).toBe(true);
  });

  it("rejects malformed or unknown messages", () => {
    expect(isExtensionRequestMessage({ type: "CREATE_VERIFICATION_SESSION" })).toBe(false);
    expect(isExtensionRequestMessage({ type: "SOMETHING_ELSE" })).toBe(false);
    expect(isExtensionRequestMessage(null)).toBe(false);
    expect(isExtensionRequestMessage("just a string")).toBe(false);
    expect(isExtensionRequestMessage(42)).toBe(false);
  });
});

describe("isExtensionResponseMessage", () => {
  it("accepts well-formed response messages", () => {
    expect(
      isExtensionResponseMessage({
        type: "VERIFICATION_STATUS_CHANGED",
        sessionId: "s1",
        status: "VERIFIED",
      }),
    ).toBe(true);
    expect(isExtensionResponseMessage({ type: "VERIFICATION_STATE", state: {} })).toBe(true);
  });

  it("rejects malformed response messages", () => {
    expect(isExtensionResponseMessage({ type: "VERIFICATION_STATUS_CHANGED" })).toBe(false);
    expect(isExtensionResponseMessage({})).toBe(false);
  });
});

describe("readPageToContentEnvelope", () => {
  function messageEvent(data: unknown, source: MessageEventSource | null = window) {
    return new MessageEvent("message", { data, source });
  }

  it("accepts a same-window message with the right channel and shape", () => {
    const result = readPageToContentEnvelope(
      messageEvent({
        channel: "verifybridge",
        direction: "page-to-content",
        message: { type: "GET_VERIFICATION_STATE" },
      }),
    );
    expect(result).toEqual({ type: "GET_VERIFICATION_STATE" });
  });

  it("rejects messages from a different window (e.g. an iframe)", () => {
    const foreignSource = { postMessage: () => {} } as unknown as MessageEventSource;
    const result = readPageToContentEnvelope(
      messageEvent(
        {
          channel: "verifybridge",
          direction: "page-to-content",
          message: { type: "GET_VERIFICATION_STATE" },
        },
        foreignSource,
      ),
    );
    expect(result).toBeNull();
  });

  it("rejects messages without the channel marker", () => {
    const result = readPageToContentEnvelope(
      messageEvent({ message: { type: "GET_VERIFICATION_STATE" } }),
    );
    expect(result).toBeNull();
  });

  it("rejects a well-formed envelope carrying a malformed inner message", () => {
    const result = readPageToContentEnvelope(
      messageEvent({
        channel: "verifybridge",
        direction: "page-to-content",
        message: { type: "CREATE_VERIFICATION_SESSION" /* missing origin */ },
      }),
    );
    expect(result).toBeNull();
  });
});
