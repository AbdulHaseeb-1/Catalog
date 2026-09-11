import { Injectable } from "@nestjs/common";
import { RedisService } from "../common/redis/redis.service.js";
import type { SessionEventsPublisher, SessionStatusChange } from "./session-events.interface.js";

export const SESSION_EVENTS_CHANNEL = "verification:events";

@Injectable()
export class RedisSessionEventsPublisher implements SessionEventsPublisher {
  constructor(private readonly redis: RedisService) {}

  async publish(change: SessionStatusChange): Promise<void> {
    await this.redis.publisher.publish(SESSION_EVENTS_CHANNEL, JSON.stringify(change));
  }
}
