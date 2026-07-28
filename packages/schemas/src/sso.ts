import { z } from "zod";

// api.md §2.1 "Enterprise SSO (SAML) + SCIM provisioning" (FR-PLAT-2).
export const ssoAttributeMappingSchema = z.object({
  email: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
});
export type SsoAttributeMapping = z.infer<typeof ssoAttributeMappingSchema>;

export const createSsoConnectionSchema = z.object({
  name: z.string().min(1).max(200),
  idpEntityId: z.string().min(1).max(500),
  idpSsoUrl: z.string().url(),
  idpCertificate: z.string().min(1),
  defaultRoleId: z.string().uuid(),
  attributeMapping: ssoAttributeMappingSchema.optional(),
});
export type CreateSsoConnectionInput = z.infer<typeof createSsoConnectionSchema>;

export const updateSsoConnectionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  idpEntityId: z.string().min(1).max(500).optional(),
  idpSsoUrl: z.string().url().optional(),
  idpCertificate: z.string().min(1).optional(),
  defaultRoleId: z.string().uuid().optional(),
  attributeMapping: ssoAttributeMappingSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateSsoConnectionInput = z.infer<typeof updateSsoConnectionSchema>;

// SCIM 2.0 (RFC 7643) User resource — deliberately permissive (extra/
// unknown fields from the IdP's schema extensions are ignored, not
// rejected) rather than a strict full-spec validator; ScimUsersService
// interprets the handful of fields ConstructionOS actually needs
// (userName, emails[0], name.formatted, active).
export const scimUserResourceSchema = z
  .object({
    userName: z.string().min(1),
    name: z
      .object({
        formatted: z.string().optional(),
        givenName: z.string().optional(),
        familyName: z.string().optional(),
      })
      .partial()
      .optional(),
    emails: z
      .array(z.object({ value: z.string().email(), primary: z.boolean().optional() }))
      .optional(),
    active: z.boolean().optional(),
  })
  .passthrough();
export type ScimUserResource = z.infer<typeof scimUserResourceSchema>;

// RFC 7644 §3.5.2 PatchOp — only "replace" is interpreted (the only
// operation an IdP's deactivate/rename flow actually needs); "add"/
// "remove" ops are accepted but no-ops if encountered, same permissive
// posture as the User resource schema above.
export const scimPatchOperationSchema = z.object({
  op: z.enum(["add", "remove", "replace"]),
  path: z.string().optional(),
  value: z.unknown().optional(),
});
export const scimPatchRequestSchema = z.object({
  Operations: z.array(scimPatchOperationSchema).min(1),
});
export type ScimPatchRequest = z.infer<typeof scimPatchRequestSchema>;

export const scimListQuerySchema = z.object({
  filter: z.string().optional(),
  startIndex: z.coerce.number().int().min(1).optional(),
  count: z.coerce.number().int().min(1).max(200).optional(),
});
export type ScimListQuery = z.infer<typeof scimListQuerySchema>;
