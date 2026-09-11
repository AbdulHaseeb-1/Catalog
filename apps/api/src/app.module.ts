import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "./common/logger/logger.module.js";
import { PrismaModule } from "./common/prisma/prisma.module.js";
import { RedisModule } from "./common/redis/redis.module.js";
import { DomainExceptionFilter } from "./common/filters/domain-exception.filter.js";
import { validateEnv } from "./config/env.schema.js";
import { VerificationModule } from "./verification/verification.module.js";
import { WebsocketModule } from "./websocket/websocket.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule,
    PrismaModule,
    RedisModule,
    VerificationModule,
    WebsocketModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
