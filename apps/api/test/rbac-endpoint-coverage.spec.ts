import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AiController } from "../src/modules/ai/api/ai.controller";
import { AuditController } from "../src/modules/audit/api/audit.controller";
import { AuthController } from "../src/modules/auth/api/auth.controller";
import { BudgetsController } from "../src/modules/budgets/api/budgets.controller";
import { ChangeOrdersController } from "../src/modules/change-orders/api/change-orders.controller";
import { PortalMessagesController } from "../src/modules/client-portal/api/portal-messages.controller";
import { SelectionsController } from "../src/modules/client-portal/api/selections.controller";
import { DailyReportsController } from "../src/modules/daily-reports/api/daily-reports.controller";
import { TimeEntriesController } from "../src/modules/daily-reports/api/time-entries.controller";
import { DashboardsController } from "../src/modules/dashboards/api/dashboards.controller";
import { DocumentsController } from "../src/modules/documents/api/documents.controller";
import { ContactCompaniesController } from "../src/modules/crm/api/contact-companies.controller";
import { ContactsController } from "../src/modules/crm/api/contacts.controller";
import { OpportunitiesController } from "../src/modules/crm/api/opportunities.controller";
import { PipelineStagesController } from "../src/modules/crm/api/pipeline-stages.controller";
import { FinanceAlertsController } from "../src/modules/finance-alerts/api/finance-alerts.controller";
import { ImportsExportsController } from "../src/modules/imports-exports/api/imports-exports.controller";
import { SyncController } from "../src/modules/sync/api/sync.controller";
import { EstimatingController } from "../src/modules/estimating/api/estimating.controller";
import { NotificationsController } from "../src/modules/notifications/api/notifications.controller";
import { PhotosController } from "../src/modules/photos/api/photos.controller";
import { PurchaseOrdersController } from "../src/modules/procurement/api/purchase-orders.controller";
import { RfqsController } from "../src/modules/procurement/api/rfqs.controller";
import { SuppliersController } from "../src/modules/procurement/api/suppliers.controller";
import { ProjectAssistantController } from "../src/modules/project-assistant/api/project-assistant.controller";
import { ProjectsController } from "../src/modules/projects/api/projects.controller";
import { RagSearchController } from "../src/modules/rag/api/rag-search.controller";
import { ExternalSharesController } from "../src/modules/rbac/api/external-shares.controller";
import { RbacController } from "../src/modules/rbac/api/rbac.controller";
import { RfisController } from "../src/modules/rfis/api/rfis.controller";
import { SchedulingController } from "../src/modules/scheduling/api/scheduling.controller";
import { TasksController } from "../src/modules/tasks/api/tasks.controller";
import { HealthController } from "../src/platform/health/health.controller";
import { IS_AUTHENTICATED_ONLY_KEY } from "../src/platform/decorators/authenticated.decorator";
import { IS_PUBLIC_KEY } from "../src/platform/decorators/public.decorator";
import { REQUIRED_PERMISSION_KEY } from "../src/modules/rbac/api/require-permission.decorator";

// Roadmap Phase 1A success metric for the RBAC row: "100% endpoints
// permission-gated (CI check)". Statically scans every controller's route
// handlers and asserts each declares exactly one of @Public(),
// @Authenticated(), or @RequirePermission(key) — PermissionGuard denies by
// default at runtime too (FR-RBAC-1), but this catches a missing marker at
// PR time instead of via a manual probe.
//
// This list has to be kept in sync by hand (no auto-discovery) — every new
// controller module must be added here too, or its endpoints silently
// stop being checked.
const controllers = [
  HealthController,
  AuthController,
  RbacController,
  ExternalSharesController,
  NotificationsController,
  AuditController,
  ProjectsController,
  BudgetsController,
  EstimatingController,
  ChangeOrdersController,
  SelectionsController,
  PortalMessagesController,
  DailyReportsController,
  TimeEntriesController,
  DashboardsController,
  DocumentsController,
  PhotosController,
  RfisController,
  SchedulingController,
  TasksController,
  ImportsExportsController,
  SyncController,
  AiController,
  RagSearchController,
  ProjectAssistantController,
  FinanceAlertsController,
  ContactsController,
  ContactCompaniesController,
  PipelineStagesController,
  OpportunitiesController,
  SuppliersController,
  PurchaseOrdersController,
  RfqsController,
];

describe("every endpoint declares exactly one access marker", () => {
  for (const ControllerClass of controllers) {
    const prototype = ControllerClass.prototype as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== "constructor",
    );

    for (const methodName of methodNames) {
      const handler = prototype[methodName];
      const isRouteHandler =
        typeof handler === "function" && Reflect.hasMetadata(PATH_METADATA, handler);
      if (!isRouteHandler) continue;

      it(`${ControllerClass.name}.${methodName}`, () => {
        const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler as object);
        const isAuthenticatedOnly = Reflect.getMetadata(
          IS_AUTHENTICATED_ONLY_KEY,
          handler as object,
        );
        const requiredPermission = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, handler as object);

        const markers = [isPublic, isAuthenticatedOnly, requiredPermission].filter(
          (v) => v !== undefined,
        );
        expect(
          markers.length,
          `expected exactly one of @Public()/@Authenticated()/@RequirePermission() on ` +
            `${ControllerClass.name}.${methodName}, found ${markers.length}`,
        ).toBe(1);
      });
    }
  }
});
