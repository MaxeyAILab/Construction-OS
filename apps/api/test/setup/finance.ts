import type { Database } from "../../src/infrastructure/db/client";
import { CompanySettingsService } from "../../src/modules/auth/application/company-settings.service";
import type { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import type { ContactCompaniesService } from "../../src/modules/crm/application/contact-companies.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { InvoicesService } from "../../src/modules/finance/application/invoices.service";
import { PaymentsService } from "../../src/modules/finance/application/payments.service";
import type { PurchaseOrdersService } from "../../src/modules/procurement/application/purchase-orders.service";
import type { SuppliersService } from "../../src/modules/procurement/application/suppliers.service";
import type { SubcontractorsService } from "../../src/modules/subcontractors/application/subcontractors.service";

export function buildTestFinanceServices(
  db: Database,
  deps: {
    purchaseOrdersService: PurchaseOrdersService;
    suppliersService: SuppliersService;
    subcontractorsService: SubcontractorsService;
    contactCompaniesService: ContactCompaniesService;
    costTransactionsService: CostTransactionsService;
  },
) {
  const outbox = new OutboxService();
  const companySettingsService = new CompanySettingsService(db, outbox);
  const invoicesService = new InvoicesService(
    db,
    outbox,
    deps.purchaseOrdersService,
    deps.suppliersService,
    deps.subcontractorsService,
    deps.contactCompaniesService,
    deps.costTransactionsService,
    companySettingsService,
  );
  return {
    invoicesService,
    paymentsService: new PaymentsService(db, outbox, invoicesService),
    companySettingsService,
  };
}
