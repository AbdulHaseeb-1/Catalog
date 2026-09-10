import { describe, expect, it } from "vitest";
import { originSchema, createVerificationSessionRequestSchema } from "../src/schemas.js";

describe("originSchema", () => {
  it("accepts bare http(s) origins", () => {
    expect(originSchema.safeParse("https://example.com").success).toBe(true);
    expect(originSchema.safeParse("http://localhost:5175").success).toBe(true);
  });

  it("rejects origins with a path, query, or trailing slash", () => {
    expect(originSchema.safeParse("https://example.com/").success).toBe(false);
    expect(originSchema.safeParse("https://example.com/path").success).toBe(false);
    expect(originSchema.safeParse("https://example.com?x=1").success).toBe(false);
  });

  it("rejects non-http(s) schemes and garbage input", () => {
    expect(originSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(originSchema.safeParse("not a url").success).toBe(false);
    expect(originSchema.safeParse("").success).toBe(false);
  });
});

describe("createVerificationSessionRequestSchema", () => {
  it("requires a valid origin field", () => {
    const result = createVerificationSessionRequestSchema.safeParse({
      origin: "https://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing origin", () => {
    expect(createVerificationSessionRequestSchema.safeParse({}).success).toBe(false);
  });
});
