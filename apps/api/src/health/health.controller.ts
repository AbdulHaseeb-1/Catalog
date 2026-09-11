import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service.js";
import { RedisService } from "../common/redis/redis.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<{ status: "ok"; database: "ok"; redis: "ok" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.client.ping();
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : "dependency unavailable",
      );
    }
    return { status: "ok", database: "ok", redis: "ok" };
  }
}
