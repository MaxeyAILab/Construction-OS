import { Module } from "@nestjs/common";
import { AuditModule } from "./modules/audit";
import { AuthModule } from "./modules/auth";
import { NotificationsModule } from "./modules/notifications";
import { RbacModule } from "./modules/rbac";
import { HealthModule } from "./platform/health/health.module";

// Global guard order matters: AuthModule registers AccessTokenGuard
// (authenticate) as an APP_GUARD; RbacModule registers PermissionGuard
// (authorize) the same way. Nest runs APP_GUARDs in resolution order, so
// AuthModule must come before RbacModule here.
@Module({
  imports: [HealthModule, AuthModule, RbacModule, NotificationsModule, AuditModule],
})
export class AppModule {}
