import type { OnModuleDestroy } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

/**
 * Three separate connections because ioredis (like Redis itself) can't mix
 * pub/sub subscription state with regular commands on the same connection.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly publisher: Redis;
  readonly subscriber: Redis;

  constructor(configService: ConfigService) {
    const url = configService.getOrThrow<string>("REDIS_URL");
    this.client = new Redis(url);
    this.publisher = new Redis(url);
    this.subscriber = new Redis(url);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.client.quit(), this.publisher.quit(), this.subscriber.quit()]);
  }
}
