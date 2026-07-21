import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const tenantIdSchema = uuidSchema.describe("companies.id — the tenant root");

// Money crosses the wire as an exact decimal string (CLAUDE.md: "Money is exact").
// NUMERIC(14,2) in Postgres; never a JS number.
export const moneyAmountSchema = z
  .string()
  .regex(/^-?\d+\.\d{2}$/, "money amounts must be decimal strings with exactly 2 places");

export const quantitySchema = z
  .string()
  .regex(/^-?\d+\.\d{3}$/, "quantities must be decimal strings with exactly 3 places");

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
