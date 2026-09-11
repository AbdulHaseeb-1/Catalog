import type { IncomingMessage } from "node:http";
import { Logger } from "@nestjs/common";
import type { OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { WebSocketGateway } from "@nestjs/websockets";
import { WS_PATH } from "@verifybridge/shared";
import type { ServerWebSocketEvent } from "@verifybridge/shared";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { WebSocket } from "ws";
import { RedisService } from "../common/redis/redis.service.js";
import { VerificationService } from "../verification/verification.service.js";
import { SESSION_EVENTS_CHANNEL } from "./redis-session-events.publisher.js";
import type { SessionStatusChange } from "./session-events.interface.js";

const CLOSE_UNAUTHORIZED = 4401;

/**
 * The desktop side of a verification session. One gateway instance per API
 * process holds only the sockets connected to *that* process; cross-process
 * fan-out for horizontal scaling goes through Redis pub/sub
 * (`SESSION_EVENTS_CHANNEL`), published by `VerificationService` via
 * `SessionEventsPublisher` and subscribed to here.
 */
@WebSocketGateway({ path: WS_PATH })
export class VerificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VerificationGateway.name);
  private readonly socketsBySession = new Map<string, Set<WebSocket>>();
  private readonly sessionIdBySocket = new WeakMap<WebSocket, string>();

  constructor(
    private readonly verificationService: VerificationService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redis.subscriber.subscribe(SESSION_EVENTS_CHANNEL);
    this.redis.subscriber.on("message", (channel: string, message: string) => {
      if (channel === SESSION_EVENTS_CHANNEL) this.handleDistributedEvent(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.subscriber.unsubscribe(SESSION_EVENTS_CHANNEL);
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const url = new URL(request.url ?? "", "http://internal");
      const token = url.searchParams.get("token");
      if (!token) {
        client.close(CLOSE_UNAUTHORIZED, "missing token");
        return;
      }
      const session = await this.verificationService.resolveByDesktopToken(token);
      this.registerSocket(client, session.id);
      this.send(client, {
        type: "connection.ack",
        sessionId: session.id,
        status: session.status,
        seq: session.seq,
      });
    } catch (error) {
      this.logger.debug({ err: error }, "rejecting websocket connection");
      client.close(CLOSE_UNAUTHORIZED, "unauthorized");
    }
  }

  handleDisconnect(client: WebSocket): void {
    const sessionId = this.sessionIdBySocket.get(client);
    if (!sessionId) return;
    const sockets = this.socketsBySession.get(sessionId);
    sockets?.delete(client);
    if (sockets && sockets.size === 0) this.socketsBySession.delete(sessionId);
  }

  private registerSocket(client: WebSocket, sessionId: string): void {
    if (!this.socketsBySession.has(sessionId)) this.socketsBySession.set(sessionId, new Set());
    this.socketsBySession.get(sessionId)?.add(client);
    this.sessionIdBySocket.set(client, sessionId);

    client.on("message", (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (parsed && typeof parsed === "object" && (parsed as { type?: unknown }).type === "ping") {
        this.send(client, { type: "pong" });
      }
    });
  }

  private handleDistributedEvent(message: string): void {
    let change: SessionStatusChange;
    try {
      change = JSON.parse(message) as SessionStatusChange;
    } catch {
      return;
    }
    const sockets = this.socketsBySession.get(change.sessionId);
    if (!sockets || sockets.size === 0) return;

    const event: ServerWebSocketEvent = {
      type: "verification.session.updated",
      sessionId: change.sessionId,
      status: change.status,
      seq: change.seq,
      occurredAt: new Date().toISOString(),
      ...(change.failureReason ? { failureReason: change.failureReason } : {}),
    };
    for (const socket of sockets) this.send(socket, event);
  }

  private send(client: WebSocket, event: ServerWebSocketEvent): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(event));
  }
}
