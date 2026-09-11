import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { RateLimitedError } from "../../verification/errors.js";
import { RedisService } from "../redis/redis.service.js";

/**
 * Fixed-window rate limit keyed on client IP + route, backed by Redis so it
 * works correctly across multiple API instances.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ttlSeconds = this.configService.getOrThrow<number>("RATE_LIMIT_TTL_SECONDS");
    const max = this.configService.getOrThrow<number>("RATE_LIMIT_MAX");
    const routeKey = `${request.method}:${request.route?.path ?? request.path}`;
    const key = `ratelimit:${routeKey}:${request.ip ?? "unknown"}`;

    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, ttlSeconds);
    }
    if (count > max) {
      throw new RateLimitedError();
    }
    return true;
  }
}
