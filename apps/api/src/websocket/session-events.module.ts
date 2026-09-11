import { Module } from "@nestjs/common";
import { RedisSessionEventsPublisher } from "./redis-session-events.publisher.js";
import { SESSION_EVENTS_PUBLISHER } from "./session-events.interface.js";

@Module({
  providers: [{ provide: SESSION_EVENTS_PUBLISHER, useClass: RedisSessionEventsPublisher }],
  exports: [SESSION_EVENTS_PUBLISHER],
})
export class SessionEventsModule {}
