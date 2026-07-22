import { Module } from "@nestjs/common";
import { AuditModule } from "./modules/audit";
import { AuthModule } from "./modules/auth";
import { BudgetsModule } from "./modules/budgets";
import { ChangeOrdersModule } from "./modules/change-orders";
import { ClientPortalModule } from "./modules/client-portal";
import { DashboardsModule } from "./modules/dashboards";
import { DocumentsModule } from "./modules/documents";
import { EstimatingModule } from "./modules/estimating";
import { FilesModule } from "./modules/files";
import { NotificationsModule } from "./modules/notifications";
import { ProjectsModule } from "./modules/projects";
import { RbacModule } from "./modules/rbac";
import { RfisModule } from "./modules/rfis";
import { SchedulingModule } from "./modules/scheduling";
import { TasksModule } from "./modules/tasks";
import { HealthModule } from "./platform/health/health.module";

// Global guard order matters: AuthModule registers AccessTokenGuard
// (authenticate) as an APP_GUARD; RbacModule registers PermissionGuard
// (authorize) the same way. Nest runs APP_GUARDs in resolution order, so
// AuthModule must come before RbacModule here.
@Module({
  imports: [
    HealthModule,
    AuthModule,
    RbacModule,
    NotificationsModule,
    AuditModule,
    FilesModule,
    ProjectsModule,
    BudgetsModule,
    EstimatingModule,
    ChangeOrdersModule,
    ClientPortalModule,
    DashboardsModule,
    DocumentsModule,
    RfisModule,
    SchedulingModule,
    TasksModule,
  ],
})
export class AppModule {}
