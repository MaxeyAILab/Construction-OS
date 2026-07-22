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

// database.md §3 / CLAUDE.md: unit rates are NUMERIC(14,4) — one more
// decimal place than money amounts, since a per-unit cost/price often
// needs sub-cent precision (e.g. $0.0125/SF) that only shows up once
// multiplied by a large quantity.
export const unitRateAmountSchema = z
  .string()
  .regex(/^-?\d+\.\d{4}$/, "unit rates must be decimal strings with exactly 4 places");

// database.md §11: percentage columns (markup/overhead/contingency/tax) —
// NUMERIC(5,2), 0.00-999.99.
export const percentageSchema = z
  .string()
  .regex(/^\d{1,3}\.\d{2}$/, "percentages must be decimal strings with exactly 2 places");

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
