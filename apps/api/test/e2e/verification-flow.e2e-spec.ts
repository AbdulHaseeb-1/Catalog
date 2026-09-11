import { RequestMethod } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { API_PREFIX } from "@verifybridge/shared";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { flushRateLimitState } from "./flush-redis.js";

describe("verification flow (e2e, real Postgres + Redis)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    await flushRateLimitState();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""), {
      exclude: [{ path: "health", method: RequestMethod.GET }],
    });
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the full CREATED -> VERIFIED handoff and delivers every step over the WebSocket", async () => {
    const http = request(app.getHttpServer());

    const createRes = await http
      .post(`${API_PREFIX}/verification-sessions`)
      .send({ origin: "https://example.com" })
      .expect(201);

    const { session, desktopToken, mobileUrl } = createRes.body;
    expect(session.status).toBe("CREATED");
    const mobileToken = mobileUrl.split("/").pop();

    const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/verification?token=${desktopToken}`);
    const received: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));

    await http.get(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}`).expect(200);
    await http.post(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}/start`).expect(200);
    const completeRes = await http
      .post(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}/complete-demo`)
      .send({ outcome: "success" })
      .expect(200);
    expect(completeRes.body.status).toBe("VERIFIED");

    const statusRes = await http
      .get(`${API_PREFIX}/verification-sessions/${session.id}/status`)
      .set("Authorization", `Bearer ${desktopToken}`)
      .expect(200);
    expect(statusRes.body.status).toBe("VERIFIED");

    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    const statuses = received.map((event) => event.status);
    expect(statuses).toEqual(["CREATED", "MOBILE_OPENED", "CAMERA_GRANTED", "VERIFYING", "VERIFIED"]);
    const seqs = received.map((event) => event.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("rejects a replayed complete-demo call once the session is already resolved", async () => {
    const http = request(app.getHttpServer());
    const createRes = await http
      .post(`${API_PREFIX}/verification-sessions`)
      .send({ origin: "https://replay-test.com" })
      .expect(201);
    const mobileToken = createRes.body.mobileUrl.split("/").pop();

    await http.get(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}`).expect(200);
    await http.post(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}/start`).expect(200);
    await http
      .post(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}/complete-demo`)
      .send({ outcome: "success" })
      .expect(200);

    const replay = await http
      .post(`${API_PREFIX}/verification-sessions/mobile/${mobileToken}/complete-demo`)
      .send({ outcome: "success" })
      .expect(410);
    expect(replay.body.error.code).toBe("SESSION_CONSUMED");
  });

  it("rejects a session claiming an origin that doesn't match the caller's Origin header", async () => {
    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/verification-sessions`)
      .set("Origin", "https://attacker.example")
      .send({ origin: "https://victim.example" })
      .expect(403);
    expect(res.body.error.code).toBe("ORIGIN_MISMATCH");
  });

  it("rejects desktop endpoints with a missing or invalid bearer token", async () => {
    const http = request(app.getHttpServer());
    await http.get(`${API_PREFIX}/verification-sessions/some-id/status`).expect(401);
    await http
      .get(`${API_PREFIX}/verification-sessions/some-id/status`)
      .set("Authorization", "Bearer not-a-real-token")
      .expect(401);
  });

  it("returns 404 for an unknown mobile token", async () => {
    await request(app.getHttpServer())
      .get(`${API_PREFIX}/verification-sessions/mobile/does-not-exist`)
      .expect(404);
  });

  it("validates the create-session request body", async () => {
    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/verification-sessions`)
      .send({ origin: "not-a-valid-origin" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
