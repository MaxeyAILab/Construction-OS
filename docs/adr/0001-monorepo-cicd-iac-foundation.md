# ADR 0001: Monorepo, CI/CD & IaC Foundation

- **Status:** Accepted
- **Date:** 2026-07-21
- **Traces to:** roadmap.md Phase 1A — "Monorepo, CI/CD, envs, IaC (arch §19)"

## Context

Phase 1A's first workstream stands up the repository skeleton everything
else builds on, per the stack already fixed in architecture.md §21 and
CLAUDE.md: pnpm + Turborepo, `apps/{api,web,mobile}`,
`packages/{ui,schemas,sync,config}`, Node 22, NestJS (Fastify), Drizzle,
Next.js/React 19, Expo.

## Decision

- **Workspace:** pnpm workspaces + Turborepo (`turbo.json` tasks: build,
  dev, lint, typecheck, test, db:generate, db:migrate). `packages/config`
  holds the shared TypeScript base configs (per target: base, NestJS,
  Next.js, React Native) and the shared ESLint flat config, including the
  module-boundary rule from architecture.md §4.2 (a module's
  `api/application/domain/infrastructure/events` folders are only
  deep-importable from within that module).
- **apps/api:** NestJS on the Fastify adapter; env loading is a zod schema
  (`src/config/env.ts`) — no ad hoc `process.env` reads; Drizzle ORM against
  Postgres via `postgres-js`, with a `withTenant()` helper that sets
  `app.tenant_id` via `set_config()` (parameterized, not string-interpolated)
  for every tenant-scoped transaction, per database.md §2/§17. A `health`
  platform endpoint stands in for the future module set.
- **apps/web:** Next.js (App Router) + React 19 + Tailwind, TanStack Query
  and the design-system package wired as dependencies (empty until the
  design-system-v1 workstream lands).
- **apps/mobile:** Expo + React Native. Two pnpm-specific fixes were needed
  beyond a stock Expo template: a custom `index.js` entry (the stock
  `expo/AppEntry.js` resolves `../../App` relatively, which breaks once
  `node_modules/expo` is a pnpm symlink into the content-addressed store),
  and `metro.config.js` with `unstable_enableSymlinks` + a `watchFolders`
  entry for the workspace root so Metro can see sibling packages.
- **CI (`​.github/workflows/ci.yml`):** lint → typecheck → test → build →
  migration dry-run, against an ephemeral Postgres 16 service container,
  matching architecture.md §19's pipeline shape. The staging/prod deploy
  jobs (canary 5%→50%→100%) are stubbed behind a `DEPLOY_ENABLED` repo
  variable rather than wired to real infrastructure that doesn't exist yet.
- **IaC (`infra/terraform/`):** environments `dev/staging/prod`, each with
  its own S3 + DynamoDB remote-state backend, and an `ecr` module
  provisioning one repository per deployable (`api`, `workers`,
  `ai-gateway`, `relay` — architecture.md §19). AWS was chosen as the
  concrete provider because architecture.md §19 names it as the
  founding-stage variant ("start on ECS/Fargate simplicity... acceptable
  variant; contracts don't change"); this ADR does **not** decide compute
  orchestration (ECS/Fargate vs. EKS/GKE) — that is an open follow-up (see
  below), since committing real compute topology without a cloud account
  to provision against would be guessing, not deciding.
- **Database provisioning:** the user is provisioning the dev Postgres
  instance directly on Supabase (personal access token supplied out of
  band, never committed) and will hand back `DATABASE_URL`. This sandbox's
  egress policy blocks `api.supabase.com` outright and does not support
  raw-TCP Postgres connections at all, so no live connection was attempted
  or is possible from here.

## Consequences

- Everything is scaffold-only where the next roadmap row owns the real
  content: `packages/ui` has no components yet (design-system-v1),
  `packages/sync` has no mutation-log logic yet (Phase 1C), and
  `apps/api/src/infrastructure/db/schema` has no tables yet (multi-tenant
  core, the next 1A row) beyond the `0000_bootstrap_extensions` migration
  (pgcrypto/vector/pg_trgm/btree_gin + a hand-rolled `uuid_generate_v7()`,
  since Postgres 16 has no native UUIDv7 generator).
- `pnpm lint|typecheck|test|build` all pass locally across all 7 packages
  as of this ADR; CI mirrors the same commands.

## Follow-ups (not decided here)

1. Compute orchestration ADR: ECS/Fargate vs. EKS/GKE, once a cloud
   account exists to provision against.
2. Wire `deploy-staging`/`deploy-prod` CI jobs to real infra once (1) lands.
3. Multi-tenant core migration (companies/users/RLS/sessions) — next
   roadmap row, depends only on this one.
