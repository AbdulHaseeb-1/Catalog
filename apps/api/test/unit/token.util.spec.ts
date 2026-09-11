import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken } from "../../src/verification/token.util.js";

describe("token.util", () => {
  it("generates high-entropy, unique, URL-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThan(32);
    }
  });

  it("hashes deterministically for the same token and secret", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token, "secret-a")).toBe(hashSessionToken(token, "secret-a"));
  });

  it("produces different hashes for different secrets or tokens", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token, "secret-a")).not.toBe(hashSessionToken(token, "secret-b"));
    expect(hashSessionToken(generateSessionToken(), "secret-a")).not.toBe(
      hashSessionToken(generateSessionToken(), "secret-a"),
    );
  });

  it("never reveals the raw token in its hash", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token, "secret");
    expect(hash).not.toContain(token);
  });
});
