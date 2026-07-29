import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { CompanySettingsService } from "../auth";
import { BudgetsModule } from "../budgets";
import { CrmModule } from "../crm";
import { DocumentsModule } from "../documents";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { ProcurementModule } from "../procurement";
import { SubcontractorsModule } from "../subcontractors";
import { InvoicesController } from "./api/invoices.controller";
import { PaymentApplicationsController } from "./api/payment-applications.controller";
import { InvoicesService } from "./application/invoices.service";
import { PaymentApplicationPdfRunnerService } from "./application/payment-application-pdf-runner.service";
import { PaymentApplicationPdfQueue } from "./application/payment-application-pdf.queue";
import { PaymentApplicationsService } from "./application/payment-applications.service";
import { PaymentsService } from "./application/payments.service";
import { PaymentApplicationPdfWorker } from "./infrastructure/payment-application-pdf.worker";

const env = loadEnv();

// Supplier Portal (M15) + Finance invoices + Payment Applications (AIA)
// (api.md §10, database.md §11). A separate module from Budgets purely to
// avoid a NestJS module import cycle — see InvoicesService's own doc
// comment for the full reasoning. Sits strictly above Budgets/Procurement/
// Subcontractors/Crm/Documents/Files; nothing imports FinanceModule back.
@Module({
  imports: [
    EventsModule,
    BudgetsModule,
    ProcurementModule,
    SubcontractorsModule,
    CrmModule,
    DocumentsModule,
    FilesModule,
  ],
  controllers: [InvoicesController, PaymentApplicationsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    InvoicesService,
    PaymentsService,
    PaymentApplicationsService,
    PaymentApplicationPdfQueue,
    PaymentApplicationPdfRunnerService,
    PaymentApplicationPdfWorker,
    CompanySettingsService,
  ],
  // api.md §15.3: BillingAgentRunnerService (AgentsModule) composes
  // create+submit under an agent's own actor — same "broaden an existing
  // module's public surface" precedent as ProcurementModule for the
  // Procurement Agent. InvoicesService is exported for FinanceAlertsModule's
  // InvoiceAnomalyService (ai-spec.md §7.10) — a read-only cross-module call
  // (getById), same "own connection, non-atomic read" precedent as every
  // other cross-module reuse this session.
  exports: [InvoicesService, PaymentApplicationsService],
})
export class FinanceModule {}
