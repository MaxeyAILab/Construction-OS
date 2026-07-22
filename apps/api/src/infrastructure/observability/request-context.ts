import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { trace } from "@opentelemetry/api";

export interface RequestContext {
  traceId?: string | undefined;
  tenantId?: string;
  /** SHA-256 hex digest of the user id — never the raw id (architecture.md §15: "user_id (hashed)" in correlated logs). */
  userIdHash?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

function setRequestContext(patch: Partial<RequestContext>): void {
  const store = requestContextStorage.getStore();
  if (store) Object.assign(store, patch);
}

/**
 * Called once per request, as early as possible (before any auth/business
 * logic runs) — establishes the ALS store for the rest of the request's
 * async chain and tags the active OTel span with the trace id it was
 * assigned, so logs emitted later in the request can self-report it.
 */
export function beginRequestContext(): void {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  requestContextStorage.enterWith({ traceId });
}

/**
 * Called by AccessTokenGuard once a bearer token verifies — attaches
 * tenant/user attribution to both the ALS store (for log correlation) and
 * the active span (for trace correlation), per architecture.md §15.
 */
export function attachAuthContext(tenantId: string, userId: string): void {
  const userIdHash = hashUserId(userId);
  setRequestContext({ tenantId, userIdHash });
  const span = trace.getActiveSpan();
  span?.setAttribute("tenant.id", tenantId);
  span?.setAttribute("user.id_hash", userIdHash);
}
