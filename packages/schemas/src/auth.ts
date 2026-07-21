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

export const mfaConfirmSchema = z.object({
  secret: z.string().min(1),
  totpCode: z.string().length(6),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime({ offset: true }),
});
