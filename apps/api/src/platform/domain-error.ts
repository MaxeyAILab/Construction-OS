// Base for application-layer errors that map directly to the api.md §1.2/1.3
// error envelope ({ error: { code, message, ... } }) via the global exception
// filter (http-exception.filter.ts), instead of NestJS's generic HttpException.
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  // Optional structured payload included in the response envelope's
  // `details` field when present (e.g. AmbiguousCompanyError's company
  // list) — mirrors the `details` HttpException already gets via
  // describe() below, undefined by default so every existing subclass's
  // bare `super("message")` call is unaffected.
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
