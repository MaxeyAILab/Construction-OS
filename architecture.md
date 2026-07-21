# ConstructionOS — System Architecture (`architecture.md`)

> **Document type:** Internal engineering architecture specification
> **Status:** Draft v1.0
> **Traces to:** `spec.md` v1.0 (modules M1–M18, FR-*, NFR-1–30)
> **Audience:** Engineering, DevOps, Security, AI
> **Downstream:** `database.md`, `api.md`, `ai-spec.md`

---

## 1. Architectural Goals & Constraints (from spec.md)

Every decision in this document is justified against these anchors:

| Anchor | Source | Architectural consequence |
|--------|--------|---------------------------|
| One unified data model | spec §18.1, BP1 | Single primary datastore for transactional truth; no per-module private silos |
| Modular, cleanly bounded | spec §18.2, NFR-22 | Modular monolith with enforced module boundaries, service-extraction-ready |
| AI as infrastructure | spec §18.3, NFR-28 | Dedicated AI gateway layer, model-agnostic, permission-aware |
| Offline-first field | spec §18.4, NFR-10–12 | Local-first mobile data layer with deterministic sync protocol |
| Multi-tenant secure by construction | spec §18.5, NFR-13–17 | Postgres Row-Level Security + tenant-scoped tokens; isolation not left to app code |
| Scale-ready | spec §18.6, NFR-5–7 | Stateless services, horizontal scaling, read replicas, cache tiers |
| Performance as a feature | spec §18.7, NFR-1–4 | P95 ≤ 300 ms budgets, optimistic UI, CDN edge, pre-aggregation |
| Observable | spec §18.8, NFR-25–26 | OpenTelemetry end-to-end, structured logs, RED/USE dashboards |
| Open & interoperable | spec §18.9, NFR-23 | Versioned public API, webhooks, integration connectors |
| Maintainable 10 years | spec §18.10 | TypeScript end-to-end, clean architecture, ADRs, automated tests |

---

## 2. Overall Architecture

ConstructionOS is a **cloud-native, multi-tenant SaaS platform** composed of:

1. **Web application** (desktop/tablet browser) — the office surface.
2. **Mobile application** (iOS/Android) — the field surface, offline-first.
3. **Core API platform** — a modular monolith exposing REST (+ WebSocket) APIs, organized into the 18 modules of spec §12.
4. **Event backbone** — transactional outbox → message bus powering integrations, automations, notifications, projections, and AI triggers.
5. **AI platform** — gateway, RAG pipeline, tool-calling runtime, and evaluation loop (detailed in `ai-spec.md`).
6. **Data platform** — PostgreSQL (system of record), Redis (cache/queues), object storage (files), search/vector indexes, and an analytics store for dashboards.
7. **Edge** — CDN, WAF, and API gateway in front of everything.

```
                        ┌──────────────────────────────────────────────┐
                        │                 EDGE LAYER                   │
                        │   CDN ── WAF ── API Gateway / LB ── Rate     │
                        └───────┬──────────────┬───────────────────────┘
                                │              │
                  ┌─────────────▼───┐   ┌──────▼─────────┐
                  │   Web App       │   │  Mobile Apps    │
                  │   (Next.js)     │   │  (React Native) │
                  └─────────┬───────┘   └──────┬──────────┘
                            │  HTTPS / WSS     │  HTTPS + Sync Protocol
                  ┌─────────▼──────────────────▼──────────┐
                  │        CORE API (Modular Monolith)     │
                  │  NestJS · REST /v1 · WebSocket · Sync  │
                  │ ┌────────┬────────┬────────┬─────────┐ │
                  │ │ Platform│ Projects│ Field │ Finance │ │
                  │ │ CRM/Est │ Docs   │ Sched │ Procure │ │
                  │ │ Equip/Inv│ Safety│ Portal│ Exec/BI │ │
                  │ └────────┴────────┴────────┴─────────┘ │
                  │  Domain events → Transactional Outbox   │
                  └──┬─────────────┬──────────────┬────────┘
                     │             │              │
        ┌────────────▼───┐  ┌──────▼───────┐  ┌───▼──────────────┐
        │ PostgreSQL      │  │ Redis        │  │ Object Storage   │
        │ (RLS, replicas) │  │ cache/queues │  │ (S3-compatible)  │
        └────────────┬───┘  └──────┬───────┘  └───┬──────────────┘
                     │             │              │
                  ┌──▼─────────────▼──────────────▼───┐
                  │           EVENT BUS (NATS)         │
                  └──┬──────────┬──────────┬──────────┘
                     │          │          │
          ┌──────────▼──┐ ┌─────▼──────┐ ┌─▼──────────────┐
          │ Workers      │ │ Notifier   │ │ AI Platform     │
          │ (BullMQ jobs)│ │ email/push │ │ gateway·RAG·    │
          │ sync/report/ │ │ in-app/SMS │ │ embeddings·     │
          │ integrations │ │            │ │ agents          │
          └──────────────┘ └────────────┘ └─┬───────┬──────┘
                                            │       │
                                     ┌──────▼──┐ ┌──▼─────────┐
                                     │ Vector  │ │ LLM        │
                                     │ Index   │ │ Providers  │
                                     └─────────┘ └────────────┘
```

---

## 3. Monolith vs Microservices Analysis

### 3.1 Options considered

**Option A — Pure microservices (18 services from day one).**
- *Pros:* Independent scaling/deployment per module; team autonomy at large org size; failure isolation.
- *Cons:* Distributed transactions across a deeply integrated domain (estimate→budget→commitment→actual is one consistency boundary); network latency added to a P95 ≤ 300 ms budget; operational overhead (18 pipelines, service discovery, contract testing) fatal for a founding team; the spec's "one unified data model" becomes eventually-consistent everywhere, which breaks live financial accuracy (FR-FIN-3).

**Option B — Classic monolith (single codebase, no internal boundaries).**
- *Pros:* Fastest start, simplest ops.
- *Cons:* Boundaries erode; 10-year maintainability (NFR-22) and eventual service extraction become rewrites; noisy-neighbor workloads (report generation, AI jobs) contend with interactive traffic.

**Option C — Modular monolith + satellite workers (chosen).**
- One deployable core API containing all 18 modules as **enforced internal modules** (separate folders, explicit public interfaces, no cross-module DB table access, dependency rules linted in CI).
- Heavy/async workloads (jobs, notifications, AI, sync processing) run in **separate worker deployments** sharing the codebase but scaled independently.
- Modules communicate in-process for synchronous flows and via **domain events** for async flows — the same event contracts a future extracted service would use.

### 3.2 Decision

**Option C.** It preserves transactional integrity inside the one domain where it matters most (financial truth), meets latency budgets, keeps ops load sane for a small team, and — because module boundaries and event contracts are enforced from day one — allows **strangler-style extraction** of hot modules (AI, Sync, Notifications, Analytics are the likely first candidates) when scale demands, without rewrite. This is the same path Shopify, GitHub, and Stripe validated at far larger scale.

**Extraction triggers (documented, objective):** a module is extracted when it (a) needs an independent scaling profile >5× the core, (b) needs a different runtime (e.g., Python for ML), or (c) is owned by a dedicated team of 4+ engineers. AI inference is extracted immediately (different runtime/scaling), which is why the AI platform is a satellite from day one.

---

## 4. Backend Architecture

### 4.1 Runtime & framework
- **Language:** TypeScript (Node.js 22 LTS). One language across backend, frontend, and mobile (spec §18.10) maximizes code sharing (validation schemas, types, sync logic) and hiring leverage.
- **Framework:** **NestJS**. Rationale: first-class modular architecture (maps 1:1 to spec modules), dependency injection for clean architecture/SOLID, mature ecosystem (OpenAPI generation, guards/interceptors for RBAC and tenancy), and testability. Trade-off vs. lighter frameworks (Fastify/Hono raw): slight overhead, accepted for enforced structure; NestJS runs on the Fastify adapter for performance.

### 4.2 Internal layering (per module, clean architecture)

```
modules/<module>/
  api/            controllers, DTOs (zod schemas), OpenAPI decorators
  application/    use-cases (commands/queries), transaction orchestration
  domain/         entities, value objects, domain events, invariants
  infrastructure/ repositories (Drizzle), external adapters
  events/         published & subscribed event contracts (versioned)
  index.ts        the ONLY public surface other modules may import
```

- **CQRS-lite:** commands go through use-cases with transactions; heavy reads go through dedicated query services (and, for dashboards, the analytics store). No event-sourcing — audit needs are met by the audit log + outbox, and event-sourcing's complexity isn't justified.
- **Cross-module rule:** module A calls module B only via B's `index.ts` application services (sync) or via domain events (async). Direct table access across modules is blocked in CI (lint rule + schema ownership map in `database.md`).

### 4.3 Transactions & consistency
- A **consistency boundary** = one Postgres transaction. The financial chain (budget/commitment/actual/CO) is always transactional (FR-FIN-*).
- Cross-boundary effects (notifications, projections, AI indexing, integrations) are **eventually consistent** via the outbox (§8). Every event carries `tenant_id`, `actor`, `entity`, `version`, `occurred_at`.

### 4.4 Background processing
- **Queue:** BullMQ on Redis (§9) for jobs: report generation, imports/exports, accounting sync, media processing (photo thumbnails/EXIF), schedule recalculation, AI pipelines.
- Workers are separate deployments of the same codebase — independent autoscaling satisfies NFR-6 (noisy-neighbor isolation) without microservice overhead.

---

## 5. Frontend Architecture (Web)

- **Framework:** **Next.js (React 19, App Router)** — SSR/streaming for fast first paint (NFR-2), file-based routing, edge-cacheable marketing/portal pages, one deployment story.
- **State:** **TanStack Query** for server state (caching, optimistic updates — the mechanism behind "instant" UI), **Zustand** for the small amount of true client state. No global Redux; server state dominates this product.
- **Styling/components:** Tailwind CSS + Radix primitives, tokens from `ui-design-system.md`. Component library in a shared `packages/ui` workspace, used by web and (via NativeWind mapping) mobile where sensible.
- **Realtime:** WebSocket subscription per active project/company scope; server pushes entity-change events; TanStack Query invalidates → UI updates live (FR collaboration, spec BP3).
- **Optimistic UI:** all mutations apply locally first with rollback on failure — perceived latency ≤ 100 ms (NFR-2).
- **Monorepo:** pnpm + Turborepo: `apps/web`, `apps/mobile`, `apps/api`, `packages/{ui,schemas,sync,config}`. Shared zod schemas are the single source of validation truth on client and server.
- **Client portal (M13) and supplier portal (M15)** are routes of the same Next.js app with external-role auth — not separate apps — to reuse components and keep scope isolation in the API where it belongs.

---

## 6. Mobile Architecture (Field, offline-first)

- **Framework:** **React Native (Expo)** — TypeScript/React skill reuse, OTA updates (critical for fast field iteration), mature native-module ecosystem (camera, GPS, background sync). Trade-off vs. native Swift/Kotlin: slightly less raw polish, decisively outweighed by one codebase and shared sync/validation logic. Performance-sensitive lists use native-driver animations and FlashList.
- **Local database:** **SQLite (via expo-sqlite/WatermelonDB-style reactive layer)** holding the field working set (NFR-11): assigned projects, today's tasks, current drawing set, open reports, reference data.
- **Local-first rule:** every field action writes to SQLite first (≤ 200 ms, NFR-3), renders immediately, and enqueues a sync mutation. The network is an optimization, never a dependency.
- **Media:** photos/videos stored on-device, uploaded in background with resumable multipart uploads; EXIF (geo/time) preserved for audit value (FR-FIELD-3).
- **Push:** FCM/APNs via the notification service (§10).
- **Sync protocol:** §14.

---

## 7. AI Architecture (summary — full spec in `ai-spec.md`)

- **AI Gateway (satellite service):** single entry point for all model calls. Responsibilities: provider abstraction (Anthropic/OpenAI/open-weights — NFR-28), per-tenant metering and budgets (NFR-27), caching, PII/tenancy guardrails (NFR-29), prompt-template registry, and full audit of every AI action (FR-AI-6).
- **RAG pipeline:** outbox events → embedding workers → **pgvector** index (per-tenant partitioned). Retrieval is **permission-filtered at query time** — the retriever runs under the caller's RBAC scope, so the assistant can never surface data the user couldn't open (FR-AI-1/2).
- **Tool-calling runtime:** AI actions execute through the same application-layer use-cases as human users, with the user's (or a narrower agent) permission set; consequential actions require explicit confirmation (FR-AI-3). No direct SQL from models, ever.
- **Why pgvector (not a dedicated vector DB) at MVP:** one operational datastore, transactional consistency with source rows, RLS applies to embeddings too. Extraction trigger: >50M vectors/tenant-scale or QPS beyond Postgres comfort → move to a dedicated store behind the same retriever interface.

---

## 8. Event-Driven Architecture

- **Pattern:** **Transactional Outbox → Event Bus.** Domain events are written to an `outbox` table in the same transaction as the business change (no dual-write problem), then relayed to the bus by a relay worker (Debezium-style polling at MVP; CDC later).
- **Bus:** **NATS JetStream.** Rationale: lightweight ops (vs. Kafka's operational weight at our stage), persistent streams, per-subject consumers, replay for rebuilding projections. Kafka becomes the extraction path only at extreme scale; the producer/consumer contracts don't change.
- **Contracts:** events are versioned JSON with a schema registry in `packages/schemas` (`project.created.v1`, `changeorder.approved.v1`, `dailyreport.submitted.v1`…). Consumers must be idempotent (delivery is at-least-once); every event carries a `dedupe_key`.
- **Consumers:** notification service, projection builders (dashboard aggregates), AI indexing, automations engine, webhook dispatcher, integration syncers.
- This satisfies NFR-24 and is the integration invariant of spec §12 made concrete.

## 9. Queue System

- **BullMQ (Redis-backed)** for work queues; NATS for pub/sub fan-out. Distinction: *queues* = units of work with retries/backoff/priorities/DLQ (report render, import, accounting sync, embedding batch); *bus* = facts that happened, many consumers.
- Per-tenant **rate-limited queue groups** prevent one tenant's 10k-row import from starving others (NFR-6).
- Every job: idempotency key, max attempts, exponential backoff, dead-letter queue with alerting, and a `job_runs` audit record.

## 10. Notification System

- **Single notification service** (worker) consuming domain events; per spec FR-PLAT-5.
- **Pipeline:** event → eligibility (who *may* see this — RBAC check) → preference resolution (per-user channel/frequency matrix) → digesting/batching (e.g., "17 tasks updated" not 17 pings) → template render (per locale) → channel adapters (in-app via WebSocket, email via SES/Postmark, push via FCM/APNs, SMS via Twilio — adapter interface, providers swappable).
- In-app notifications persisted (`notifications` table) with read state synced across devices; mobile offline queue delivers on reconnect.
- Critical alerts (margin breach FR-FIN-6, safety incident FR-SAFE-3) bypass digesting.

---

## 11. Authentication

- **Protocol:** OIDC/OAuth 2.1. MVP: email+password (Argon2id), TOTP MFA (FR-PLAT-2); Enterprise: SSO via SAML/OIDC (Okta, Entra), SCIM provisioning (roadmap).
- **Implementation:** self-hosted identity module within the platform (thin wrapper over `oidc-provider`/Lucia-style primitives) — auth is too central to outsource pricing-wise at millions of users; Auth0-class SaaS rejected on cost-at-scale, though the interface is kept adapter-shaped.
- **Tokens:** short-lived access JWT (≤ 15 min) carrying `sub`, `tenant_id`, `roles`, `session_id`; rotating refresh tokens (httpOnly cookies on web; secure storage on mobile). Long offline mobile sessions use refresh tokens valid ≥ 30 days with device binding + revocation list.
- **External users** (client/sub/supplier) authenticate the same way but their principals carry external role scopes only (spec §10); magic-link login supported for low-friction client onboarding.
- Session revocation is immediate (FR-PLAT-10): access tokens are short-lived and a Redis denylist covers the gap.

## 12. Authorization & RBAC

- **Model (from spec §10):** permissions are `module.resource.action` strings; roles are permission bundles; assignments exist at **company level** and **project level**; external roles are share-scoped.
- **Enforcement — three layers, defense in depth:**
  1. **API guard (NestJS):** declarative `@RequirePermission('finance.invoice.approve')` on every endpoint; deny-by-default (FR-RBAC-1).
  2. **Application layer:** use-cases receive an `AccessContext` and apply record-level rules (project membership, ownership, share scope).
  3. **Database:** Postgres **Row-Level Security** on `tenant_id` for every table — even a code bug cannot cross tenants (NFR-14); external-share scoping additionally filtered at the query layer.
- **Policy storage:** roles/permissions in DB (see `database.md`), cached in Redis with event-driven invalidation; permission checks are in-memory per request (target < 1 ms).
- Maker/checker approval chains (enterprise) modeled as workflow rules on top of permissions, not new permission types.
- Every grant/revoke/elevation is audited (FR-RBAC-4).

## 13. File & Object Storage

- **Object store:** S3 (or R2/GCS — S3-compatible interface). Layout: `tenant/{tenant_id}/project/{project_id}/...` with **per-tenant KMS encryption keys** (crypto-shredding satisfies GDPR erasure, NFR-15).
- **Uploads:** client → presigned multipart URLs (API never proxies bytes); resumable for field photos on weak signal. Post-upload workers: virus scan (ClamAV), EXIF extraction, thumbnailing, PDF page rasterization for drawings (fast mobile rendering, FR-DOC-5), text extraction → AI indexing.
- **Downloads:** short-TTL signed URLs via CDN; drawing tiles cached at edge.
- **Metadata** (versions, folders, permissions) lives in Postgres — the object store holds only bytes; versioning per FR-DOC-2 is a DB concern with immutable object keys per version.
- Retention/legal hold policies per tenant (construction disputes → documents kept ≥ statute-of-repose periods, configurable).

## 14. Realtime Communication & Offline Synchronization

### 14.1 Realtime (office surfaces)
- **WebSocket gateway** (part of core API, sticky via Redis pub/sub across instances). Clients subscribe to scopes (`project:{id}`, `company-dashboard`); server pushes compact entity-change notices; clients refetch through the normal (RBAC-enforced) API. Pushing IDs-not-payloads keeps authorization single-pathed.
- Presence and lightweight collaborative cues (who's viewing, typing) via the same channel. Full CRDT co-editing is out of scope until a proven need (P2 principle: simplicity).

### 14.2 Offline sync (field, NFR-10–12)
- **Protocol: mutation-log sync (not state sync).**
  - Each offline action = an immutable **mutation record** `{client_id, mutation_id (uuid), entity, op, field_changes, base_version, captured_at}` in SQLite.
  - On connectivity, mutations upload in order; server applies them through the same use-case layer (validation + RBAC + events fire normally), records applied `mutation_id`s for idempotency, and returns fresh entity versions.
  - Download side: delta pull per entity scope using `updated_seq` cursors (server keeps a per-tenant monotonic sequence).
- **Conflict resolution (deterministic, per spec C3/NFR-12):**
  - Field-level merge: non-overlapping field changes merge automatically.
  - Overlapping scalar fields: **last-capture-wins** using `captured_at` (offline time still ordered), both values kept in the entity's history.
  - Append-only entities (photos, time entries, log lines, safety forms) are conflict-free by construction — the schema is deliberately biased toward append-only for field objects.
  - Non-mergeable conflicts (e.g., both edited the same schedule dependency) → flagged `needs_resolution`, surfaced in-app to a human; **never silently dropped**.
- **Working set:** server-defined per user (assigned projects, current drawings, 30-day lookback), pre-downloaded on wifi; size-budgeted with LRU eviction (media stays cloud-linked with local thumbnails).

---

## 15. Logging, Monitoring & Observability (NFR-25/26)

- **Standard:** OpenTelemetry everywhere — traces (API request → DB → queue → worker, one trace id), metrics, logs correlated by `trace_id`/`tenant_id`/`user_id`(hashed).
- **Stack:** OTel Collector → Grafana LGTM (Loki logs, Tempo traces, Mimir metrics) self-hosted at MVP (cost), Datadog as the managed alternative if ops time becomes the constraint.
- **Structured logging:** JSON, no PII in logs, log levels enforced; audit log is a *separate, immutable* store (see `database.md`), not the app log.
- **SLOs & alerting:** availability and latency SLOs per NFR-1/8 with burn-rate alerts; RED dashboards per module; queue depth/DLQ alarms; sync-failure rate is a first-class SLO (field trust, NFR-10).
- **Product analytics:** event stream (PostHog self-hosted) keyed to the success metrics in spec §15 — every feature ships with instrumentation (NFR-26).

## 16. Security Architecture (NFR-13–17)

- **Edge:** WAF (OWASP CRS), API gateway rate limiting (per token, per tenant, per IP), TLS 1.2+ only, HSTS.
- **App:** input validation via shared zod schemas on every boundary; output encoding; CSRF protection on cookie flows; strict CORS; security headers (CSP nonce-based).
- **Data:** AES-256 at rest (DB, object store, backups), per-tenant KMS keys for objects; field-level encryption for high-sensitivity columns (bank details) — see `database.md`.
- **Secrets:** cloud KMS + secrets manager; no secrets in env files or code; short-lived DB credentials via IAM where supported.
- **Supply chain:** lockfile pinning, Dependabot/Renovate, `npm audit` gate, container image scanning (Trivy), signed images, SBOM.
- **SDLC:** mandatory code review, SAST (Semgrep) in CI, threat model per new module, annual external pentest; SOC 2 Type II program from month one (evidence automation, e.g., Vanta-class tooling).
- **Tenant isolation:** RLS (NFR-14) + tenant-scoped tokens + per-tenant object prefixes/keys + per-tenant AI budgets. Isolation is tested in CI with an automated cross-tenant probe suite.
- **AI security:** prompt-injection defenses, retrieval scoped to caller permissions, no training on tenant data, provider DPAs (NFR-29; details in `ai-spec.md`).

## 17. Multi-Tenancy Strategy

- **Model: shared database, shared schema, RLS-enforced `tenant_id` on every row.**
- *Why not schema-per-tenant:* thousands of tenants × hundreds of tables = migration and connection-pool nightmare; cross-tenant platform analytics impossible; ops cost explodes.
- *Why not DB-per-tenant:* only justified for enterprise data-residency/dedicated tiers — **supported as an escape hatch**: the architecture keeps all tenant access behind a connection-resolver so an enterprise tenant can be pinned to a dedicated cluster/region without app changes (spec Enterprise roadmap).
- `tenant_id` is set from the JWT into `app.tenant_id` (Postgres GUC) per request/transaction; RLS policies reference it; no query can omit it. Background jobs carry explicit tenant context; platform-level jobs use a break-glass role with full audit.
- Noisy-neighbor controls: per-tenant API rate limits, queue quotas, AI budgets, statement timeouts.

## 18. Scaling Strategy (NFR-5–7)

| Layer | Mechanism |
|-------|-----------|
| Web/API | Stateless containers behind LB; horizontal autoscale on CPU/latency; WebSocket fan-out via Redis pub/sub |
| Workers | Autoscale per queue depth; per-tenant concurrency caps |
| PostgreSQL | Vertical first (simplest), then read replicas for query/report traffic; PgBouncer pooling; table partitioning for hot append-only data (events, audit, time entries, notifications — see `database.md`); Citus/sharding only at extreme scale (tenant_id is the natural shard key, held in reserve) |
| Redis | Clustered; separate logical instances for cache vs queues |
| Object storage | Inherently horizontal; CDN offloads reads |
| Analytics | Dashboard aggregates precomputed via projections (NFR-4); heavy OLAP moves to ClickHouse when replica + projections stop sufficing (extraction trigger documented) |
| AI | Independent satellite autoscaling; response/embedding caches; batch pipelines off-peak |

Load-shedding order under stress: analytics → AI enrichment → notifications digesting → never core writes.

## 19. Deployment Strategy

- **Packaging:** Docker images per deployable (api, workers, ai-gateway, relay); IaC with Terraform; environments: `dev` → `staging` → `prod` (staging is prod-shaped with synthetic tenants).
- **Orchestration:** managed Kubernetes (EKS/GKE). Justification: worker/queue/WS topology outgrows PaaS quickly; K8s gives autoscaling, rollout primitives, and cloud portability. (Founding-stage alternative: start on ECS/Fargate simplicity and lift to K8s at the first scaling trigger — acceptable variant; contracts don't change.)
- **CI/CD:** GitHub Actions — lint/typecheck/test → build → migration dry-run (against staging clone) → deploy staging → smoke/e2e (Playwright) → progressive prod rollout (canary 5% → 50% → 100%) with auto-rollback on SLO burn.
- **DB migrations:** expand-migrate-contract pattern only (no breaking migrations while old code runs); migrations are forward-only with tested down-paths for emergencies.
- **Mobile:** Expo EAS builds; OTA updates for JS-layer changes; store releases biweekly; server maintains API compatibility with the two previous mobile versions (NFR C8).
- **Feature flags:** first-class (per-tenant targeting) for progressive delivery and enterprise gating.

## 20. Disaster Recovery (NFR-8/9)

- **Backups:** Postgres continuous WAL archiving + daily base backups → cross-region bucket; PITR to any minute in 14 days. Object storage: versioning + cross-region replication. Redis: cache is rebuildable; queues use AOF + accepted small replay window (jobs are idempotent).
- **Targets:** RPO ≤ 5 min (WAL shipping interval), RTO ≤ 1 h (runbook-driven regional restore, rehearsed quarterly via game days).
- **Failure domains:** multi-AZ everything in-region; region failure → warm standby (replica promotion + IaC re-provision) at enterprise tier, documented cold restore at MVP tier.
- **Data integrity:** backup restore verification automated weekly (restore → checksum → row-count drift alarms).
- **Incident program:** on-call rotation, severity matrix, status page, blameless postmortems with tracked actions.

## 21. Recommended Technology Stack (summary)

| Concern | Choice | Key rationale |
|---------|--------|---------------|
| Language | TypeScript end-to-end | One language, shared schemas/types, spec §18.10 |
| Backend | Node 22 + NestJS (Fastify adapter) | Enforced modularity, DI, OpenAPI, testability |
| ORM | Drizzle | Type-safe SQL, migration control, no magic |
| Database | PostgreSQL 16 (+ pgvector, PostGIS) | One system of record; RLS tenancy; vectors + geo in-house |
| Cache/queues | Redis + BullMQ | Mature jobs with retries/DLQ |
| Event bus | NATS JetStream | Persistent streams, light ops; Kafka as scale path |
| Web | Next.js + React 19, TanStack Query, Tailwind + Radix | Fast paint, optimistic UI, token-driven design system |
| Mobile | React Native (Expo) + SQLite | Offline-first, OTA updates, code sharing |
| Search | Postgres FTS → OpenSearch (trigger-based) | Start simple, extract on scale |
| Vectors | pgvector → dedicated store (trigger-based) | Consistency + RLS first |
| Files | S3-compatible + CDN + presigned uploads | Scale, cost, per-tenant keys |
| Auth | OIDC self-hosted, JWT + rotating refresh, SAML for enterprise | Cost at scale, control |
| Observability | OpenTelemetry + Grafana LGTM, Sentry, PostHog | NFR-25/26 |
| Infra | Docker, Terraform, managed K8s, GitHub Actions | Progressive delivery, portability |
| AI | Provider-agnostic gateway (Anthropic-first), pgvector RAG | NFR-27–29; full detail in `ai-spec.md` |

---

## 22. Architecture Decision Records

Key decisions above are tracked as ADRs in `/docs/adr/` (ADR-001 modular monolith, ADR-002 RLS multi-tenancy, ADR-003 outbox+NATS, ADR-004 mutation-log offline sync, ADR-005 pgvector-first, ADR-006 self-hosted auth…). Any change to these requires a superseding ADR and an amendment PR to this document.

---

*End of `architecture.md` v1.0.*
