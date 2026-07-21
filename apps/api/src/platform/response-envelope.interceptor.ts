import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

// api.md §1.2: every success response is wrapped as { data: ... }. Handlers
// that already build the list envelope themselves ({ data, meta }) pass
// through unchanged rather than being double-wrapped; 204 responses
// (undefined body) pass through as-is.
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined) return body;
        if (body && typeof body === "object" && ("data" in body || "error" in body)) {
          return body;
        }
        return { data: body };
      }),
    );
  }
}
