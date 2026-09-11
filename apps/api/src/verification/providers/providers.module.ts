import { Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DemoVerificationProvider } from "./demo.provider.js";
import { VERIFICATION_PROVIDER } from "./verification-provider.interface.js";
import type { VerificationProvider } from "./verification-provider.interface.js";

const logger = new Logger("ProvidersModule");

@Module({
  providers: [
    DemoVerificationProvider,
    {
      provide: VERIFICATION_PROVIDER,
      inject: [ConfigService, DemoVerificationProvider],
      useFactory: (
        configService: ConfigService,
        demoProvider: DemoVerificationProvider,
      ): VerificationProvider => {
        const name = configService.getOrThrow<string>("VERIFICATION_PROVIDER");
        switch (name) {
          case "demo":
            logger.warn(
              "Using the DEMO verification provider - development only, does not perform real identity verification.",
            );
            return demoProvider;
          default:
            throw new Error(
              `Unknown VERIFICATION_PROVIDER "${name}". Only "demo" ships built-in - implement ` +
                "VerificationProvider and register it here to use a real vendor.",
            );
        }
      },
    },
  ],
  exports: [VERIFICATION_PROVIDER],
})
export class ProvidersModule {}
