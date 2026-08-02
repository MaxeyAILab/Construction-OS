import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AccountingController } from "../src/modules/accounting/api/accounting.controller";
import { AgentIdentitiesController } from "../src/modules/agents/api/agent-identities.controller";
import { AiController } from "../src/modules/ai/api/ai.controller";
import { AuditController } from "../src/modules/audit/api/audit.controller";
import { ApiKeysController } from "../src/modules/auth/api/api-keys.controller";
import { AuthController } from "../src/modules/auth/api/auth.controller";
import { CompanySettingsController } from "../src/modules/auth/api/company-settings.controller";
import { ScimGroupsController } from "../src/modules/auth/api/scim-groups.controller";
import { ScimUsersController } from "../src/modules/auth/api/scim-users.controller";
import { SsoConnectionsController } from "../src/modules/auth/api/sso-connections.controller";
import { SsoLoginController } from "../src/modules/auth/api/sso-login.controller";
import { BudgetsController } from "../src/modules/budgets/api/budgets.controller";
import { ChangeOrdersController } from "../src/modules/change-orders/api/change-orders.controller";
import { PortalMessagesController } from "../src/modules/client-portal/api/portal-messages.controller";
import { ComplianceAlertsController } from "../src/modules/compliance-alerts/api/compliance-alerts.controller";
import { SelectionsController } from "../src/modules/client-portal/api/selections.controller";
import { CustomFieldAdminController } from "../src/modules/custom-fields/api/custom-field-admin.controller";
import { CustomFieldValuesController } from "../src/modules/custom-fields/api/custom-field-values.controller";
import { ApprovalInstancesController } from "../src/modules/transmittals/api/approval-instances.controller";
import { ApprovalMatricesController } from "../src/modules/transmittals/api/approval-matrices.controller";
import { TransmittalsController } from "../src/modules/transmittals/api/transmittals.controller";
import { DailyReportsController } from "../src/modules/daily-reports/api/daily-reports.controller";
import { TimeEntriesController } from "../src/modules/daily-reports/api/time-entries.controller";
import { DashboardsController } from "../src/modules/dashboards/api/dashboards.controller";
import { ReportsController } from "../src/modules/dashboards/api/reports.controller";
import { DocumentsController } from "../src/modules/documents/api/documents.controller";
import { EquipmentInsightsController } from "../src/modules/equipment/api/equipment-insights.controller";
import { EquipmentController } from "../src/modules/equipment/api/equipment.controller";
import { MaintenanceController } from "../src/modules/equipment/api/maintenance.controller";
import { ContactCompaniesController } from "../src/modules/crm/api/contact-companies.controller";
import { ContactsController } from "../src/modules/crm/api/contacts.controller";
import { OpportunitiesController } from "../src/modules/crm/api/opportunities.controller";
import { PipelineStagesController } from "../src/modules/crm/api/pipeline-stages.controller";
import { InvoicesController } from "../src/modules/finance/api/invoices.controller";
import { PaymentApplicationsController } from "../src/modules/finance/api/payment-applications.controller";
import { CashflowForecastController } from "../src/modules/finance-alerts/api/cashflow-forecast.controller";
import { FinanceAlertsController } from "../src/modules/finance-alerts/api/finance-alerts.controller";
import { ImportsExportsController } from "../src/modules/imports-exports/api/imports-exports.controller";
import { InventoryItemsController } from "../src/modules/inventory/api/inventory-items.controller";
import { InventoryLocationsController } from "../src/modules/inventory/api/inventory-locations.controller";
import { StockController } from "../src/modules/inventory/api/stock.controller";
import { SyncController } from "../src/modules/sync/api/sync.controller";
import { BidPackagesController } from "../src/modules/estimating/api/bid-packages.controller";
import { EstimatingController } from "../src/modules/estimating/api/estimating.controller";
import { NotificationsController } from "../src/modules/notifications/api/notifications.controller";
import { PhotosController } from "../src/modules/photos/api/photos.controller";
import { ProcurementAiController } from "../src/modules/procurement/api/procurement-ai.controller";
import { PurchaseOrdersController } from "../src/modules/procurement/api/purchase-orders.controller";
import { RfqsController } from "../src/modules/procurement/api/rfqs.controller";
import { SuppliersController } from "../src/modules/procurement/api/suppliers.controller";
import { ProjectAssistantController } from "../src/modules/project-assistant/api/project-assistant.controller";
import { ProjectsController } from "../src/modules/projects/api/projects.controller";
import { RagSearchController } from "../src/modules/rag/api/rag-search.controller";
import { ExternalSharesController } from "../src/modules/rbac/api/external-shares.controller";
import { RbacController } from "../src/modules/rbac/api/rbac.controller";
import { RfisController } from "../src/modules/rfis/api/rfis.controller";
import { CertificationsController } from "../src/modules/safety/api/certifications.controller";
import { IncidentsController } from "../src/modules/safety/api/incidents.controller";
import { SafetyFormTemplatesController } from "../src/modules/safety/api/safety-form-templates.controller";
import { SafetyFormsController } from "../src/modules/safety/api/safety-forms.controller";
import { SchedulingController } from "../src/modules/scheduling/api/scheduling.controller";
import { SubcontractorsController } from "../src/modules/subcontractors/api/subcontractors.controller";
import { SubcontractsController } from "../src/modules/subcontractors/api/subcontracts.controller";
import { SubmittalsController } from "../src/modules/submittals/api/submittals.controller";
import { TasksController } from "../src/modules/tasks/api/tasks.controller";
import { CloseoutChecklistController } from "../src/modules/warranty-closeout/api/closeout-checklist.controller";
import { CloseoutPackagesController } from "../src/modules/warranty-closeout/api/closeout-packages.controller";
import { WarrantiesController } from "../src/modules/warranty-closeout/api/warranties.controller";
import { WarrantyClaimsController } from "../src/modules/warranty-closeout/api/warranty-claims.controller";
import { WebhooksController } from "../src/modules/webhooks/api/webhooks.controller";
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
  CompanySettingsController,
  ApiKeysController,
  SsoConnectionsController,
  SsoLoginController,
  ScimUsersController,
  ScimGroupsController,
  AgentIdentitiesController,
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
  ComplianceAlertsController,
  DailyReportsController,
  TimeEntriesController,
  DashboardsController,
  ReportsController,
  DocumentsController,
  PhotosController,
  RfisController,
  SchedulingController,
  TasksController,
  SubmittalsController,
  ImportsExportsController,
  SyncController,
  AiController,
  RagSearchController,
  ProjectAssistantController,
  FinanceAlertsController,
  CashflowForecastController,
  ContactsController,
  ContactCompaniesController,
  PipelineStagesController,
  OpportunitiesController,
  SuppliersController,
  PurchaseOrdersController,
  RfqsController,
  ProcurementAiController,
  InventoryItemsController,
  InventoryLocationsController,
  StockController,
  EquipmentController,
  MaintenanceController,
  EquipmentInsightsController,
  SafetyFormTemplatesController,
  SafetyFormsController,
  IncidentsController,
  CertificationsController,
  SubcontractorsController,
  SubcontractsController,
  BidPackagesController,
  InvoicesController,
  PaymentApplicationsController,
  AccountingController,
  WebhooksController,
  CloseoutChecklistController,
  CloseoutPackagesController,
  WarrantiesController,
  WarrantyClaimsController,
  CustomFieldAdminController,
  CustomFieldValuesController,
  TransmittalsController,
  ApprovalMatricesController,
  ApprovalInstancesController,
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
