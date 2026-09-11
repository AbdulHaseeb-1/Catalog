import { Module } from "@nestjs/common";
import { SessionEventsModule } from "../websocket/session-events.module.js";
import { ProvidersModule } from "./providers/providers.module.js";
import { VerificationController } from "./verification.controller.js";
import { VerificationRepository } from "./verification.repository.js";
import { VerificationService } from "./verification.service.js";

@Module({
  imports: [ProvidersModule, SessionEventsModule],
  controllers: [VerificationController],
  providers: [VerificationService, VerificationRepository],
  exports: [VerificationService, ProvidersModule],
})
export class VerificationModule {}
