import pino from "pino";
import { getRequestContext } from "./request-context";

// architecture.md §15: "Structured logging: JSON, no PII in logs, log
// levels enforced" + "logs correlated by trace_id/tenant_id/user_id
// (hashed)". This is Fastify's own logger (passed as `loggerInstance`),
// not a separate app-level logger — every request/response line Fastify
// already emits goes through the same redaction + correlation.
export function createLogger(level: string, destination?: pino.DestinationStream) {
  return pino({
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Deny-by-default would be safer but Fastify's own req/res serializers
    // populate these paths; redact covers the fields most likely to carry
    // secrets that pass through request/response logging or app-level
    // `logger.info({ ... })` calls elsewhere.
    redact: {
      // pino's redact paths are not recursive (no `**` wildcard) — `*.foo`
      // only matches `foo` one level deep, so each sensitive field name
      // needs both its bare (root-level) and one-level-nested form to
      // catch `logger.info({ password: ... })` as well as
      // `logger.info({ body: { password: ... } })`.
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        ...["password", "newPassword", "token", "accessToken", "refreshToken", "mfaSecret", "totpCode", "secret"].flatMap(
          (field) => [field, `*.${field}`],
        ),
      ],
      censor: "[redacted]",
    },
    mixin() {
      const ctx = getRequestContext();
      if (!ctx) return {};
      return {
        ...(ctx.traceId && { traceId: ctx.traceId }),
        ...(ctx.tenantId && { tenantId: ctx.tenantId }),
        ...(ctx.userIdHash && { userIdHash: ctx.userIdHash }),
      };
    },
  }, destination);
}
