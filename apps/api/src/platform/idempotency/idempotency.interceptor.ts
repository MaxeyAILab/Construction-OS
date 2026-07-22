import { createHash } from "node:crypto";
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import { firstValueFrom, from } from "rxjs";
import { DATABASE, type Database, withTenant } from "../../infrastructure/db/client";
import { idempotencyKeys } from "../../infrastructure/db/schema";
import type { AuthenticatedRequest } from "../../modules/auth";
import { IdempotencyKeyReusedError } from "./idempotency-key-reused.error";

const TTL_MS = 24 * 60 * 60 * 1000;

// api.md §1.7: "All POSTs accept Idempotency-Key header (UUID, 24h window)
// — mandatory for financial mutations and mobile clients." Applied
// per-route via @UseInterceptors(IdempotencyInterceptor) on the specific
// POST handlers that need it (not global — most POSTs, e.g. auth/login,
// have no dedupe semantics), matching how ResponseEnvelopeInterceptor is
// global but this is opt-in.
//
// A missing header is NOT rejected here — api.md frames it as mandatory
// for a subset of callers (financial mutations, mobile), which this layer
// can't distinguish from the request alone; a caller that omits it simply
// gets no replay protection, same as calling a non-idempotent endpoint.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<ReturnType<CallHandler["handle"]>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers["idempotency-key"];
    const key = Array.isArray(header) ? header[0] : header;
    const tenantId = request.auth?.tenantId;

    if (!key || !tenantId) {
      return next.handle();
    }

    const endpoint = `${context.getClass().name}.${context.getHandler().name}`;
    const requestHash = createHash("sha256").update(JSON.stringify(request.body ?? {})).digest("hex");

    const existing = await withTenant(this.db, tenantId, (tx) =>
      tx.query.idempotencyKeys.findFirst({
        where: and(
          eq(idempotencyKeys.tenantId, tenantId),
          eq(idempotencyKeys.endpoint, endpoint),
          eq(idempotencyKeys.key, key),
        ),
      }),
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyKeyReusedError();
      }
      context.switchToHttp().getResponse<{ status(code: number): void }>().status(existing.responseStatus);
      return from(Promise.resolve(existing.responseBody));
    }

    const result = await firstValueFrom(next.handle());

    const httpCode = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    const responseStatus = httpCode ?? (request.method === "POST" ? 201 : 200);

    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(idempotencyKeys).values({
        tenantId,
        endpoint,
        key,
        requestHash,
        responseStatus,
        responseBody: result,
        expiresAt: new Date(Date.now() + TTL_MS),
      }),
    );

    return from(Promise.resolve(result));
  }
}
