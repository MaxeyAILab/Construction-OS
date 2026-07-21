import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth";
import { HealthModule } from "./platform/health/health.module";

@Module({
  imports: [HealthModule, AuthModule],
})
export class AppModule {}
