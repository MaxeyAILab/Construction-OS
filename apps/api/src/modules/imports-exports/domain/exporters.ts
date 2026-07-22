import type { ExportEntityType } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { type Database, withTenant } from "../../../infrastructure/db/client";
import {
  budgetLines,
  budgets,
  changeOrders,
  costCodes,
  projects,
  rfis,
  tasks,
} from "../../../infrastructure/db/schema";

export interface ExportResult {
  headers: string[];
  rows: Array<Record<string, string>>;
}

// api.md §14 (FR-PLAT-7, A8 "no lock-in"): a full export is tenant-wide
// (every project's rows), not scoped to one project — someone leaving the
// platform wants everything, not a project-by-project trickle. This
// registry covers the entities most valuable for an actual data migration;
// exhaustively covering every table in this codebase in one pass would
// blow past this row's own "M complexity" budget. Adding another entity
// later is one new function + one line in `exporters`, not a redesign.
type Exporter = (db: Database, tenantId: string) => Promise<ExportResult>;

async function exportProjects(db: Database, tenantId: string): Promise<ExportResult> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.query.projects.findMany({ where: and(eq(projects.tenantId, tenantId), isNull(projects.deletedAt)) }),
  );
  return {
    headers: ["code", "name", "status", "startDate", "targetEndDate", "contractValueAmount", "currency"],
    rows: rows.map((p) => ({
      code: p.code,
      name: p.name,
      status: p.status,
      startDate: p.startDate ?? "",
      targetEndDate: p.targetEndDate ?? "",
      contractValueAmount: p.contractValueAmount ?? "",
      currency: p.currency,
    })),
  };
}

async function exportCostCodes(db: Database, tenantId: string): Promise<ExportResult> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ projectCode: projects.code, code: costCodes.code, name: costCodes.name, division: costCodes.division, kind: costCodes.kind })
      .from(costCodes)
      .innerJoin(projects, eq(costCodes.projectId, projects.id))
      .where(eq(costCodes.tenantId, tenantId)),
  );
  return {
    headers: ["projectCode", "code", "name", "division", "kind"],
    rows: rows.map((r) => ({
      projectCode: r.projectCode,
      code: r.code,
      name: r.name,
      division: r.division ?? "",
      kind: r.kind,
    })),
  };
}

async function exportBudgetLines(db: Database, tenantId: string): Promise<ExportResult> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        projectCode: projects.code,
        costCode: costCodes.code,
        costCodeName: costCodes.name,
        originalAmount: budgetLines.originalAmount,
        revisedAmount: budgetLines.revisedAmount,
        committedAmount: budgetLines.committedAmount,
        actualAmount: budgetLines.actualAmount,
        forecastAtCompletionAmount: budgetLines.forecastAtCompletionAmount,
      })
      .from(budgetLines)
      .innerJoin(budgets, eq(budgetLines.budgetId, budgets.id))
      .innerJoin(projects, eq(budgets.projectId, projects.id))
      .innerJoin(costCodes, eq(budgetLines.costCodeId, costCodes.id))
      .where(eq(budgetLines.tenantId, tenantId)),
  );
  return {
    headers: [
      "projectCode",
      "costCode",
      "costCodeName",
      "originalAmount",
      "revisedAmount",
      "committedAmount",
      "actualAmount",
      "forecastAtCompletionAmount",
    ],
    rows: rows.map((r) => ({
      projectCode: r.projectCode,
      costCode: r.costCode,
      costCodeName: r.costCodeName,
      originalAmount: r.originalAmount,
      revisedAmount: r.revisedAmount ?? "",
      committedAmount: r.committedAmount,
      actualAmount: r.actualAmount,
      forecastAtCompletionAmount: r.forecastAtCompletionAmount,
    })),
  };
}

async function exportChangeOrders(db: Database, tenantId: string): Promise<ExportResult> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        projectCode: projects.code,
        number: changeOrders.number,
        title: changeOrders.title,
        status: changeOrders.status,
        costImpactAmount: changeOrders.costImpactAmount,
        priceImpactAmount: changeOrders.priceImpactAmount,
        scheduleImpactDays: changeOrders.scheduleImpactDays,
      })
      .from(changeOrders)
      .innerJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(and(eq(changeOrders.tenantId, tenantId), isNull(changeOrders.deletedAt))),
  );
  return {
    headers: ["projectCode", "number", "title", "status", "costImpactAmount", "priceImpactAmount", "scheduleImpactDays"],
    rows: rows.map((r) => ({
      projectCode: r.projectCode,
      number: String(r.number),
      title: r.title,
      status: r.status,
      costImpactAmount: r.costImpactAmount,
      priceImpactAmount: r.priceImpactAmount,
      scheduleImpactDays: String(r.scheduleImpactDays),
    })),
  };
}

async function exportRfis(db: Database, tenantId: string): Promise<ExportResult> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        projectCode: projects.code,
        number: rfis.number,
        subject: rfis.subject,
        status: rfis.status,
        dueDate: rfis.dueDate,
      })
      .from(rfis)
      .innerJoin(projects, eq(rfis.projectId, projects.id))
      .where(and(eq(rfis.tenantId, tenantId), isNull(rfis.deletedAt))),
  );
  return {
    headers: ["projectCode", "number", "subject", "status", "dueDate"],
    rows: rows.map((r) => ({
      projectCode: r.projectCode,
      number: String(r.number),
      subject: r.subject,
      status: r.status,
      dueDate: r.dueDate ?? "",
    })),
  };
}

async function exportTasks(db: Database, tenantId: string): Promise<ExportResult> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        projectCode: projects.code,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        kind: tasks.kind,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.tenantId, tenantId), isNull(tasks.deletedAt))),
  );
  return {
    headers: ["projectCode", "title", "status", "priority", "dueDate", "kind"],
    rows: rows.map((r) => ({
      projectCode: r.projectCode,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate ?? "",
      kind: r.kind,
    })),
  };
}

export const exporters: Record<ExportEntityType, Exporter> = {
  projects: exportProjects,
  cost_codes: exportCostCodes,
  budget_lines: exportBudgetLines,
  change_orders: exportChangeOrders,
  rfis: exportRfis,
  tasks: exportTasks,
};
