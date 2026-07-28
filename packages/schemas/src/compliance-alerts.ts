import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// api.md §15.4 "Compliance Agent" (FR-SUB-2, FR-SAFE-2). Reuses
// CertificationsService's own due-state vocabulary — this table only
// ever records the two states worth chasing.
export const complianceAlertDueStateSchema = z.enum(["expiring_soon", "expired"]);
export type ComplianceAlertDueState = z.infer<typeof complianceAlertDueStateSchema>;

export const listComplianceAlertsQuerySchema = paginationQuerySchema.extend({
  subcontractorId: uuidSchema.optional(),
});
export type ListComplianceAlertsQuery = z.infer<typeof listComplianceAlertsQuerySchema>;
