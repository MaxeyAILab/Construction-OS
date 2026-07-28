import { Inject, Injectable } from "@nestjs/common";
import type { ComplianceAlertDueState } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { complianceAlerts } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";

export interface RaiseComplianceAlertInput {
  certificationId: string;
  subcontractorId: string;
  dueState: ComplianceAlertDueState;
  expiresAt: string;
}

// api.md §15.4 "Compliance Agent". The compliance_alerts table's only
// write path — module-boundary rule: AgentsModule (the only caller)
// never touches this table directly, it calls through here, same
// "modules communicate only via public surface" precedent as every
// other cross-module reuse this session.
@Injectable()
export class ComplianceAlertsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  // actorType: internal-only, same "undefined for humans, 'ai' only from
  // the agent runner" precedent as PurchaseOrdersService.create/
  // PaymentApplicationsService.create — though in practice only the
  // Compliance Agent ever calls this (there is no human-facing "raise a
  // compliance alert" endpoint), the shape matches for consistency.
  async raiseIfNew(tenantId: string, actorId: string, input: RaiseComplianceAlertInput, actorType?: "ai") {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.complianceAlerts.findFirst({
        where: and(eq(complianceAlerts.certificationId, input.certificationId), eq(complianceAlerts.dueState, input.dueState)),
      });
      if (existing) return null;

      const [created] = await tx
        .insert(complianceAlerts)
        .values({
          tenantId,
          certificationId: input.certificationId,
          subcontractorId: input.subcontractorId,
          dueState: input.dueState,
          expiresAt: input.expiresAt,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "compliance_alert.raised.v1",
        dedupeKey: `compliance_alert.raised.v1:${created!.id}`,
        actorId,
        ...(actorType ? { actorType } : {}),
        payload: {
          companyId: tenantId,
          complianceAlertId: created!.id,
          certificationId: input.certificationId,
          subcontractorId: input.subcontractorId,
          dueState: input.dueState,
        },
      });

      return created!;
    });
  }
}
