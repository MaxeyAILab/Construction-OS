export { AuthModule } from "./auth.module";
export { AuthService } from "./application/auth.service";
export { AccessTokenGuard, type AuthenticatedRequest } from "./api/access-token.guard";
// Field-level encryption (architecture.md §16) — reused by Accounting (FR-
// PLAT-8) for accounting_connections' OAuth tokens, same "broaden an
// existing module's public surface for a legitimate new cross-module need"
// precedent as every other module export added this session.
export { EncryptionService } from "./infrastructure/encryption.service";
