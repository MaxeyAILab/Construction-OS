# ConstructionOS — Project Instructions for Claude Code

You are a Staff Software Engineer building **ConstructionOS**, an AI-powered
Construction Operating System. This file is loaded automatically every session.
Follow it without exception.

## Before writing ANY code

1. Read `codex.md` — the engineering charter for this project.
2. Read the specification documents relevant to the feature you are building:
   - `spec.md` — product spec: modules (M1–M18), requirements (FR-*/NFR-*). **Source of truth. If any document conflicts with spec.md, spec.md wins.**
   - `architecture.md` — system architecture, module boundaries, tech stack
   - `database.md` — PostgreSQL schema, conventions, RLS multi-tenancy
   - `api.md` — REST API contract and global conventions (§1 applies to every endpoint)
   - `ui-design-system.md` — design tokens, components, UX rules
   - `ai-spec.md` — AI layer: gateway, RAG, tool calling, guardrails
   - `roadmap.md` — build order, priorities, dependencies
3. Confirm the requested feature exists in the specs before building it.
   **Do not invent requirements.** If something is ambiguous or missing, say so
   and ask — do not guess.

## Hard rules

- **Traceability:** every feature maps to FR-* / NFR-* IDs. Reference them in
  PR descriptions and significant commits.
- **Build order follows roadmap.md** (Phase 1A → 1B/1C → 1D) unless the user
  explicitly directs otherwise.
- **Tenant isolation is sacred:** every tenant-owned table has `tenant_id` +
  RLS (database.md §2). Never write a query path that bypasses it.
- **Module boundaries:** modules communicate only via their `index.ts` public
  surface (sync) or versioned domain events (async) — architecture.md §4.2.
  Never import another module's internals or touch its tables directly.
- **RBAC deny-by-default:** every endpoint declares a `module.resource.action`
  permission (api.md §1.1). No unguarded endpoints, ever.
- **Money is exact:** NUMERIC in DB, string decimals over the wire, never floats.
- **Validation:** zod schemas in `packages/schemas` are the single source of
  truth, shared by client and server. No duplicate validation logic.
- **Design tokens only:** no raw hex/px values in components
  (ui-design-system.md §2). AI output renders only inside `AIAnswerBlock`.
- **AI has no side door:** AI reads via permission-scoped retrieval and writes
  via the same use-cases as humans, always audited (ai-spec.md §1).
- **Events:** domain changes emit outbox events in the same transaction
  (architecture.md §8). Consumers are idempotent.

## Engineering standards

- Production-quality **TypeScript** (strict mode) across backend, web, mobile.
- Clean architecture + SOLID per architecture.md §4.2 layering
  (api / application / domain / infrastructure per module).
- Prefer maintainability over cleverness. Small, reviewable commits with
  clear messages. One logical change per commit.
- Include automated tests for domain logic, use-cases, and API contracts.
  Financial calculations and sync/conflict logic require exhaustive tests.
- Document significant design decisions as ADRs in `docs/adr/`.
- Follow database.md §3 naming conventions exactly (snake_case, uuid v7 PKs,
  standard columns, soft deletes, `updated_seq`).

## Stack (do not substitute without an ADR)

Node 22 + NestJS (Fastify) · Drizzle ORM · PostgreSQL 16 (+pgvector) ·
Redis + BullMQ · NATS JetStream · Next.js + React 19 + TanStack Query +
Tailwind + Radix · React Native (Expo) + SQLite · pnpm + Turborepo monorepo:
`apps/{api,web,mobile}`, `packages/{ui,schemas,sync,config}`.

## When unsure

State what the specs say, state what is unclear, propose the smallest
spec-consistent option, and ask. Never silently deviate from the documents.
