import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

// api.md §1.2: every success response is wrapped as { data: ... }. Handlers
// that already build the list envelope themselves ({ data, meta }) pass
// through unchanged rather than being double-wrapped; 204 responses
// (undefined body) pass through as-is.
//
// The envelope check requires the body's keys to be an exact subset of
// {data, meta, error} — not merely "contains one of them" — because a real
// domain row can legitimately have its own field named `error` (e.g.
// export_jobs.error, a job's failure message) or `data`. Only a
// hand-built envelope (this codebase's one shape: AuditQueryService's
// `{ data, meta }`) has *exclusively* those keys.
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined) return body;
        if (body && typeof body === "object" && this.isEnvelope(body)) {
          return body;
        }
        return { data: body };
      }),
    );
  }

  private isEnvelope(body: object): boolean {
    const keys = Object.keys(body);
    return keys.length > 0 && keys.every((k) => k === "data" || k === "meta" || k === "error");
  }
}
