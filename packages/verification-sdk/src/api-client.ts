import { API_PREFIX } from "@verifybridge/shared";
import type {
  ApiErrorBody,
  CreateVerificationSessionResponse,
  ErrorCode,
  MobileSessionView,
  VerificationSessionDTO,
} from "@verifybridge/shared";

export class ApiClientError extends Error {
  readonly code: ErrorCode | "NETWORK_ERROR" | "UNKNOWN_ERROR";
  readonly status: number;

  constructor(message: string, code: ApiClientError["code"], status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

export interface VerificationApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody["error"] | null> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body && typeof body === "object" && "error" in body && body.error) {
      return body.error;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Thin typed wrapper around the VerifyBridge REST API. Shared by the Chrome
 * extension's background service worker and the mobile PWA so both stay in
 * sync with the same contract (`@verifybridge/shared`).
 */
export class VerificationApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VerificationApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { auth?: string } = {},
  ): Promise<T> {
    const { auth, headers, ...rest } = init;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${API_PREFIX}${path}`, {
        ...rest,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...headers,
        },
      });
    } catch (cause) {
      throw new ApiClientError(
        cause instanceof Error ? cause.message : "Network request failed",
        "NETWORK_ERROR",
        0,
      );
    }

    if (!response.ok) {
      const error = await parseErrorBody(response);
      throw new ApiClientError(
        error?.message ?? `Request failed with status ${response.status}`,
        error?.code ?? "UNKNOWN_ERROR",
        response.status,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  /** Creates a new verification session for the given desktop origin. */
  createSession(origin: string): Promise<CreateVerificationSessionResponse> {
    return this.request<CreateVerificationSessionResponse>("/verification-sessions", {
      method: "POST",
      body: JSON.stringify({ origin }),
    });
  }

  /** Desktop-only: current session status, for polling fallback when the WebSocket is down. */
  getSessionStatus(sessionId: string, desktopToken: string): Promise<VerificationSessionDTO> {
    return this.request<VerificationSessionDTO>(`/verification-sessions/${sessionId}/status`, {
      method: "GET",
      auth: desktopToken,
    });
  }

  /** Desktop-only: cancels an in-progress session. */
  cancelSession(sessionId: string, desktopToken: string, reason?: string): Promise<void> {
    return this.request<void>(`/verification-sessions/${sessionId}/cancel`, {
      method: "POST",
      auth: desktopToken,
      body: JSON.stringify({ reason }),
    });
  }

  /** Mobile-only: fetches the (non-sensitive) view of a session by its mobile token. */
  getMobileSession(mobileToken: string): Promise<MobileSessionView> {
    return this.request<MobileSessionView>(
      `/verification-sessions/mobile/${encodeURIComponent(mobileToken)}`,
      { method: "GET" },
    );
  }

  /** Mobile-only: signals the user granted camera access and verification should begin. */
  startMobileVerification(mobileToken: string): Promise<MobileSessionView> {
    return this.request<MobileSessionView>(
      `/verification-sessions/mobile/${encodeURIComponent(mobileToken)}/start`,
      { method: "POST" },
    );
  }

  /**
   * Mobile-only, development provider only: simulates the provider
   * confirming (or rejecting) the verification. The API rejects this call
   * unless `VERIFICATION_PROVIDER=demo`, so it can never be used to forge a
   * result against a real provider.
   */
  completeDemoVerification(
    mobileToken: string,
    outcome: "success" | "failure" = "success",
  ): Promise<MobileSessionView> {
    return this.request<MobileSessionView>(
      `/verification-sessions/mobile/${encodeURIComponent(mobileToken)}/complete-demo`,
      { method: "POST", body: JSON.stringify({ outcome }) },
    );
  }
}
