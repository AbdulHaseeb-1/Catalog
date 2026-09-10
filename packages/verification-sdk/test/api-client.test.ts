import { describe, expect, it, vi } from "vitest";
import { ApiClientError, VerificationApiClient } from "../src/api-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VerificationApiClient", () => {
  it("creates a session and returns the parsed body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        session: { id: "s1", origin: "https://example.com", status: "CREATED" },
        desktopToken: "desktop-token",
        mobileUrl: "https://verify.example.com/session/mobile-token",
        wsUrl: "ws://localhost:4000/ws/verification?token=desktop-token",
      }),
    );
    const client = new VerificationApiClient({ baseUrl: "http://localhost:4000", fetchImpl });

    const result = await client.createSession("https://example.com");

    expect(result.desktopToken).toBe("desktop-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/verification-sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws a typed ApiClientError with the server's error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(410, { error: { code: "SESSION_EXPIRED", message: "This session has expired." } }),
    );
    const client = new VerificationApiClient({ baseUrl: "http://localhost:4000", fetchImpl });

    await expect(client.getMobileSession("tok")).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      status: 410,
    });
  });

  it("wraps network failures as NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new VerificationApiClient({ baseUrl: "http://localhost:4000", fetchImpl });

    const error = await client.getMobileSession("tok").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("NETWORK_ERROR");
  });

  it("sends the desktop token as a bearer header for desktop-scoped calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new VerificationApiClient({ baseUrl: "http://localhost:4000", fetchImpl });

    await client.cancelSession("s1", "desktop-token");

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer desktop-token");
  });
});
