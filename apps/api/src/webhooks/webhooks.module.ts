import { Module } from "@nestjs/common";
import { VerificationModule } from "../verification/verification.module.js";
import { WebhooksController } from "./webhooks.controller.js";

@Module({
  imports: [VerificationModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
