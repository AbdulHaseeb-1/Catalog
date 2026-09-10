import { describe, expect, it } from "vitest";
import { canTransition, isTerminalStatus } from "../src/status.js";

describe("verification status transitions", () => {
  it("allows the happy path forward", () => {
    expect(canTransition("CREATED", "MOBILE_OPENED")).toBe(true);
    expect(canTransition("MOBILE_OPENED", "CAMERA_GRANTED")).toBe(true);
    expect(canTransition("CAMERA_GRANTED", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "CONSUMED")).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(canTransition("CREATED", "VERIFIED")).toBe(false);
    expect(canTransition("CREATED", "CONSUMED")).toBe(false);
  });

  it("rejects transitions out of terminal states", () => {
    expect(canTransition("VERIFIED", "VERIFYING")).toBe(false);
    expect(canTransition("FAILED", "VERIFYING")).toBe(false);
    expect(canTransition("EXPIRED", "MOBILE_OPENED")).toBe(false);
    expect(canTransition("CONSUMED", "VERIFIED")).toBe(false);
  });

  it("rejects replaying the same status", () => {
    expect(canTransition("VERIFIED", "VERIFIED")).toBe(false);
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalStatus("VERIFIED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("EXPIRED")).toBe(true);
    expect(isTerminalStatus("CONSUMED")).toBe(true);
    expect(isTerminalStatus("CREATED")).toBe(false);
    expect(isTerminalStatus("VERIFYING")).toBe(false);
  });
});
