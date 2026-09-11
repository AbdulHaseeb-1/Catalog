import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";

/**
 * Structured, PII-safe request logging. Tokens, cookies, and full request
 * bodies (which could carry a `reason` free-text field, etc.) are redacted
 * before they ever reach a log sink - VerifyBridge never logs raw tokens,
 * face images, or provider secrets.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProd = configService.get<string>("NODE_ENV") === "production";
        return {
          pinoHttp: {
            level: isProd ? "info" : "debug",
            transport: isProd
              ? undefined
              : { target: "pino-pretty", options: { singleLine: true, colorize: true } },
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.body",
                "res.headers",
              ],
              remove: true,
            },
            serializers: {
              req: (req: { method: string; url: string }) => ({
                method: req.method,
                url: req.url,
              }),
            },
            autoLogging: {
              ignore: (req: { url?: string }) => req.url === "/health",
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
