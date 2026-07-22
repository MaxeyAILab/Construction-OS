import { z } from "zod";
import { uuidSchema } from "./common";

export const createRoleSchema = z.object({
  name: z.string().min(1),
});

export const grantPermissionSchema = z.object({
  permissionKey: z.string().min(1),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  // database.md §17: "Portal users are users + company_users(kind=
  // 'external') + external_shares." Defaults to 'internal' (every prior
  // invite this session was an employee) — a client/sub/supplier invite
  // sets this explicitly so record-level access is share-scoped, not
  // role-scoped, per architecture.md's external-user model.
  kind: z.enum(["internal", "external"]).default("internal"),
});

export const assignRoleSchema = z.object({
  userId: uuidSchema,
  roleId: uuidSchema,
  scopeType: z.enum(["company", "project"]),
  projectId: uuidSchema.optional(),
});

// database.md §7 (FR-RBAC-3): the grant behind client/sub/supplier
// scoping. `entityType`/`entityId` name the specific record being shared
// (e.g. entityType: "change_order") — external principals get no access
// beyond what's explicitly granted here.
export const externalShareAudienceSchema = z.enum(["client", "subcontractor", "supplier"]);
export type ExternalShareAudience = z.infer<typeof externalShareAudienceSchema>;

export const externalShareAccessSchema = z.enum(["view", "approve", "comment"]);
export type ExternalShareAccess = z.infer<typeof externalShareAccessSchema>;

export const createExternalShareSchema = z.object({
  principalUserId: uuidSchema,
  audience: externalShareAudienceSchema,
  entityType: z.string().min(1),
  entityId: uuidSchema,
  access: externalShareAccessSchema,
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateExternalShareInput = z.infer<typeof createExternalShareSchema>;

export const listExternalSharesQuerySchema = z.object({
  principalUserId: uuidSchema.optional(),
  entityType: z.string().optional(),
  entityId: uuidSchema.optional(),
});
export type ListExternalSharesQuery = z.infer<typeof listExternalSharesQuerySchema>;
