// Base for application-layer errors that map directly to the api.md §1.2/1.3
// error envelope ({ error: { code, message, ... } }) via the global exception
// filter (http-exception.filter.ts), instead of NestJS's generic HttpException.
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
}
