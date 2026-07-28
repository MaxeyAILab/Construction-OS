import { z } from "zod";
import { uuidSchema } from "./common";

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  fullName: z.string().min(1),
  companyName: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  companyId: uuidSchema.optional(),
  totpCode: z.string().length(6).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const magicLinkRequestSchema = z.object({
  email: z.string().email(),
  companyId: uuidSchema,
});

export const magicLinkConsumeSchema = z.object({
  token: z.string().min(1),
});

// api.md §2: POST /auth/password/forgot -> /auth/password/reset. forgot()
// always returns 202 regardless of whether the email exists (no user
// enumeration); reset() consumes the single-use tokenized link.
export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12),
});

export const mfaConfirmSchema = z.object({
  secret: z.string().min(1),
  totpCode: z.string().length(6),
});

// api.md §2: POST /auth/mfa/verify — completes the two-step MFA challenge
// login() returns when MFA is enabled and no totpCode was supplied inline.
export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  totpCode: z.string().length(6),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime({ offset: true }),
});

// api.md §2: "GET/PATCH /auth/me/preferences | Locale, notification
// prefs." Scoped here to the one field users actually owns directly
// (users.locale — NFR-30 activation). The detailed per-category ×
// channel × digest notification matrix already has its own dedicated
// endpoint (api.md §12: GET/PUT /notification-preferences, FR-PLAT-5) —
// this endpoint doesn't duplicate that surface.
export const updateUserPreferencesSchema = z.object({
  locale: z.string().min(2).max(35).optional(),
});
export type UpdateUserPreferencesInput = z.infer<typeof updateUserPreferencesSchema>;
