import { Module } from "@nestjs/common";
import { VerificationModule } from "../verification/verification.module.js";
import { VerificationGateway } from "./verification.gateway.js";

@Module({
  imports: [VerificationModule],
  providers: [VerificationGateway],
})
export class WebsocketModule {}
