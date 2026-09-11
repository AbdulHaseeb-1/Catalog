import { RequestMethod } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { API_PREFIX } from "@verifybridge/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flushRateLimitState } from "./flush-redis.js";

// Must be set before AppModule (and its ConfigModule) is imported/compiled.
// Vitest may run other e2e files in the same worker process, so the
// original values are restored in afterAll to avoid leaking these
// overrides into a test file that expects the defaults.
const originalEnv = {
  SESSION_TTL_SECONDS: process.env.SESSION_TTL_SECONDS,
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
  RATE_LIMIT_TTL_SECONDS: process.env.RATE_LIMIT_TTL_SECONDS,
};
process.env.SESSION_TTL_SECONDS = "1";
process.env.RATE_LIMIT_MAX = "3";
process.env.RATE_LIMIT_TTL_SECONDS = "60";

const { AppModule } = await import("../../src/app.module.js");

describe("verification edge cases: expiry and rate limiting (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    await flushRateLimitState();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""), {
      exclude: [{ path: "health", method: RequestMethod.GET }],
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("fails a non-terminal session securely once its short TTL has elapsed", async () => {
    const http = request(app.getHttpServer());
    const createRes = await http
      .post(`${API_PREFIX}/verification-sessions`)
      .send({ origin: "https://expiry-test.com" })
      .expect(201);
    const mobileToken = createRes.body.mobileUrl.split("/").pop();

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const res = await http
      .get(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}`)
      .expect(410);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");

    // Expired is sticky - it doesn't come back on a second look.
    const again = await http
      .get(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}`)
      .expect(410);
    expect(again.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("rate-limits repeated session creation from the same caller", async () => {
    await flushRateLimitState(); // isolate from the create-session call in the previous test
    const http = request(app.getHttpServer());
    const results: number[] = [];
    for (let i = 0; i < 5; i += 1) {
       
      const res = await http
        .post(`${API_PREFIX}/verification-sessions`)
        .send({ origin: "https://rate-limit-test.com" });
      results.push(res.status);
    }
    expect(results.slice(0, 3)).toEqual([201, 201, 201]);
    expect(results.slice(3)).toEqual([429, 429]);
  });
});
