import { randomUUID } from "node:crypto";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError } from "./domain-error";

// api.md §1.2/§1.3: every error response is { error: { code, message,
// details?, trace_id } } with the documented status codes.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const traceId = randomUUID();

    if (exception instanceof DomainError) {
      void reply
        .status(exception.status)
        .send({ error: { code: exception.code, message: exception.message, trace_id: traceId } });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const { message, details } = this.describe(exception.getResponse());
      void reply
        .status(status)
        .send({ error: { code: this.codeForStatus(status), message, details, trace_id: traceId } });
      return;
    }

    this.logger.error(exception);
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: { code: "internal_error", message: "an unexpected error occurred", trace_id: traceId },
    });
  }

  private describe(response: unknown): { message: string; details?: unknown } {
    if (typeof response === "string") return { message: response };
    if (response && typeof response === "object") {
      const obj = response as Record<string, unknown>;
      const message =
        typeof obj["message"] === "string" ? (obj["message"] as string) : JSON.stringify(obj);
      const { message: _message, statusCode: _statusCode, error: _error, ...rest } = obj;
      return { message, details: Object.keys(rest).length > 0 ? rest : undefined };
    }
    return { message: "request failed" };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "malformed_request";
      case HttpStatus.UNAUTHORIZED:
        return "unauthorized";
      case HttpStatus.FORBIDDEN:
        return "forbidden";
      case HttpStatus.NOT_FOUND:
        return "not_found";
      case HttpStatus.CONFLICT:
        return "conflict";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "validation_failed";
      case HttpStatus.TOO_MANY_REQUESTS:
        return "rate_limited";
      default:
        return "error";
    }
  }
}
