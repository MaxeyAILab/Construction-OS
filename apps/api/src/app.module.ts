import { Module } from "@nestjs/common";
import { HealthModule } from "./platform/health/health.module.js";

@Module({
  imports: [HealthModule],
})
export class AppModule {}
