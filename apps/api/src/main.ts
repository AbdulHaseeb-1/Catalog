import { RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { WsAdapter } from "@nestjs/platform-ws";
import { API_PREFIX } from "@verifybridge/shared";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { parseOriginList } from "./config/env.schema.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""), {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });

  app.use(
    helmet({
      // No inline scripts/styles anywhere in this API's own responses (it
      // serves JSON only), so a strict default-src is safe.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );

  const configService = app.get(ConfigService);
  const allowedOrigins = parseOriginList(configService.getOrThrow<string>("CORS_ALLOWED_ORIGINS"));
  app.enableCors({
    // CORS only controls which *browser pages* may read the response - it
    // is not an access-control mechanism for the API itself (that's the
    // job of session tokens / origin-binding / rate limiting below), so an
    // unrecognized origin just means "don't add CORS headers", not "reject
    // the request".
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  const port = configService.getOrThrow<number>("API_PORT");
  await app.listen(port);
}

await bootstrap();
