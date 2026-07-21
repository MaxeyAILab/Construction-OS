# ConstructionOS — REST API Specification (`api.md`)

> **Document type:** API contract specification
> **Status:** Draft v1.0
> **Traces to:** `spec.md` (FR-*), `architecture.md` (§4, §11–12), `database.md`
> **Base URL:** `https://api.constructionos.com/v1`
> **Format:** JSON (UTF-8), `Content-Type: application/json`

---

## 1. Global Conventions

Every endpoint in this document inherits these conventions. Per-endpoint sections only state what *differs*.

### 1.1 Authentication
- **Scheme:** `Authorization: Bearer <access_jwt>` (15-min JWT; refresh via `/auth/refresh`). Server-to-server: `X-Api-Key: <key>` with scoped API keys.
- All endpoints require authentication unless marked **Public**.
- Every request executes under the caller's tenant (`tenant_id` from token) and RBAC scope (`module.resource.action` — spec §10). A missing permission returns `403` with the permission key named.

### 1.2 Standard response envelope

```json
// Success (single)          // Success (list)
{ "data": { ... } }          { "data": [ ... ], "meta": { "cursor": "…", "has_more": true, "total": 124 } }

// Error
{ "error": { "code": "validation_failed", "message": "qty must be positive",
             "details": [{ "field": "lines[2].qty", "rule": "positive" }],
             "trace_id": "abc-123" } }
```

### 1.3 Status codes (uniform)
| Code | Meaning |
|------|---------|
| 200 | OK (read/update) |
| 201 | Created |
| 202 | Accepted (async job started; body carries `job_id`) |
| 204 | No content (delete) |
| 400 | Malformed request |
| 401 | Missing/invalid token |
| 403 | Authenticated but not permitted (body names the permission) |
| 404 | Not found *or* out of tenant scope (indistinguishable by design) |
| 409 | Conflict (version mismatch, duplicate, illegal state transition) |
| 422 | Validation failed (schema-valid JSON, invalid business data) |
| 429 | Rate limited (`Retry-After` header) |
| 500/503 | Server error (safe message + `trace_id`) |

### 1.4 Validation
- All bodies validated by shared zod schemas (`packages/schemas`) — same schemas the clients use, so client and server can never disagree. Unknown fields rejected (`400`). IDs are UUIDs. Money: string decimals (`"1250.00"`) to avoid float loss. Dates: ISO-8601 (`2026-07-21` / `2026-07-21T08:30:00Z`).

### 1.5 Pagination, filtering, sorting, search (all list endpoints)
- **Pagination:** cursor-based — `?limit=50` (max 200) `&cursor=<opaque>`; response `meta.cursor`/`has_more`. (Cursor = keyset on `(updated_seq,id)`; stable under writes, scales per NFR-7.)
- **Filtering:** `?filter[status]=open&filter[assignee_id]=…&filter[due_date][gte]=2026-07-01`. Operators: `eq` (default), `ne,gt,gte,lt,lte,in,contains,null`. Filterable fields whitelisted per resource.
- **Sorting:** `?sort=-created_at,name` (`-` = desc). Sortable fields whitelisted.
- **Search:** `?q=` — trigram/FTS per resource (see `database.md`); semantic search lives under `/ai/search` (§13).
- **Sparse fields / expansion:** `?fields=id,name,status` and `?expand=client,budget_summary` (bounded whitelist, no arbitrary joins).

### 1.6 Rate limits
| Tier | Limit | Burst |
|------|-------|-------|
| Standard user token | 300 req/min | 60/10 s |
| Tenant aggregate | 3,000 req/min | — |
| API key (integration) | 600 req/min | — |
| AI endpoints | 30 req/min/user + tenant AI budget (NFR-27) |
| Auth endpoints | 10 req/min/IP |

Headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 1.7 Concurrency & idempotency
- Mutable resources carry `version` (int). Updates send `If-Match: <version>` → `409 version_conflict` on mismatch (optimistic locking; pairs with offline sync).
- All POSTs accept `Idempotency-Key` header (UUID, 24 h window) — mandatory for financial mutations and mobile clients.

### 1.8 Versioning & deprecation
- Path-versioned (`/v1`). Additive changes are non-breaking; breaking changes → `/v2` with ≥ 12-month overlap and `Sunset` headers (NFR-23, C8).

### 1.9 Async jobs
- Long operations return `202 { "data": { "job_id": "…" } }`; poll `GET /jobs/{id}` → `{status: queued|running|succeeded|failed, result, error}`; or subscribe via WebSocket/webhook `job.completed`.

---

## 2. Authentication & Session API

| Method | Path | Description | Notes |
|--------|------|-------------|-------|
| POST | `/auth/register` | Create company + owner account | **Public.** Body: company_name, email, password, full_name. 201 → verification email flow |
| POST | `/auth/login` | Password login | **Public.** Returns access+refresh; `mfa_required` → step-up |
| POST | `/auth/mfa/verify` | Complete TOTP challenge | **Public** (mfa_token) |
| POST | `/auth/refresh` | Rotate refresh → new access | Cookie (web) or body (mobile) |
| POST | `/auth/logout` | Revoke session family | 204 |
| POST | `/auth/password/forgot` → `/auth/password/reset` | Reset flow | **Public**, tokenized |
| POST | `/auth/magic-link` | Client/external low-friction login | **Public** (spec §11 external UX) |
| GET | `/auth/me` | Current principal: user, tenant, roles, permissions, entitlements | Cached client-side; invalidated by `user.updated` WS event |
| GET/PATCH | `/auth/me/preferences` | Locale, notification prefs | |

**Example**

```http
POST /v1/auth/login
{ "email": "dana@buildco.com", "password": "•••" }

200 { "data": { "access_token": "eyJ…", "expires_in": 900,
                "user": { "id": "…", "full_name": "Dana Reyes" },
                "tenant": { "id": "…", "name": "BuildCo" } } }
```

---

## 3. Projects API (M4)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/projects` | `projects.project.read` | List (filter: status, q, client; sort: name, start_date, health) |
| POST | `/projects` | `projects.project.create` | Create (optionally `template_id`, `from_opportunity_id` — FR-CRM-4) |
| GET | `/projects/{id}` | read | Detail; `expand=budget_summary,health,team,client` |
| PATCH | `/projects/{id}` | update | Partial update, `If-Match` |
| DELETE | `/projects/{id}` | delete | Soft delete, 204 |
| GET | `/projects/{id}/summary` | read | Command-center aggregate (FR-PM-3): health, schedule variance, margin, open items — served from projections |
| GET/POST/DELETE | `/projects/{id}/members` | `projects.member.manage` | Team & per-project roles (FR-RBAC-2) |
| GET/POST/PATCH | `/projects/{id}/cost-codes` | `projects.costcode.manage` | WBS tree |
| GET/POST/PATCH | `/projects/{id}/milestones` | update | Milestones |

**Validation highlights:** `code` unique per tenant (409 `duplicate_code`); status transitions via `PATCH {status}` validated against state machine (422 `illegal_transition`); closing a project requires zero open change orders in `pending_client`.

**Example**

```http
POST /v1/projects
Idempotency-Key: 018f…
{ "name": "Riverside Apartments", "code": "RSA-26", "client_contact_company_id": "…",
  "template_id": "…", "start_date": "2026-08-01", "contract_value_amount": "2450000.00", "currency": "USD" }

201 { "data": { "id": "…", "code": "RSA-26", "status": "planning", "version": 1, … } }
```

---

## 4. CRM API (M1)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/crm/contacts` · `/crm/companies` | `crm.contact.*` | Contacts & external orgs; `?q=` trigram search |
| GET/PATCH/DELETE | `/crm/contacts/{id}` | | |
| GET/POST | `/crm/opportunities` | `crm.opportunity.*` | Pipeline (filter: stage, status, close date range; sort: -expected_value) |
| PATCH | `/crm/opportunities/{id}` | update | Stage moves audited |
| POST | `/crm/opportunities/{id}/win` | `crm.opportunity.win` | Atomic: marks won, creates project (+links estimate) — FR-CRM-4. Body: `{project: {code, start_date…}}` |
| POST | `/crm/opportunities/{id}/lose` | update | `{lost_reason}` |
| GET/POST | `/crm/opportunities/{id}/activities` | `crm.activity.*` | Timeline |
| GET/POST/PATCH | `/crm/pipeline-stages` | `crm.settings.manage` | Tenant stage config |
| GET | `/crm/opportunities/{id}/ai-insights` | read + AI | Win probability + reasoning (FR-CRM-5); `{score, confidence, factors[], ai_run_id}` |

---

## 5. Estimating API (M2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/estimates` | `estimating.estimate.*` | Filter: opportunity_id, project_id, status |
| GET/PATCH | `/estimates/{id}` | | Header totals recomputed server-side |
| POST | `/estimates/{id}/versions` | create | New version (FR-EST-4) |
| GET/POST/PATCH/DELETE | `/estimates/{id}/lines` | | Bulk ops: `POST /lines:batch` (≤500/req) |
| POST | `/estimates/{id}/convert-to-budget` | `finance.budget.create` | Atomic estimate→budget with cost-code mapping (FR-EST-5). 409 if active budget exists |
| GET/POST | `/cost-items` · `/assemblies` | `estimating.costbook.*` | Cost book & assemblies; import via `/imports` |
| GET | `/cost-items/{id}/price-history` | read | Ledger feed (chart-ready) |
| POST | `/estimates/{id}/ai/suggest-lines` | + AI | Estimator AI (FR-EST-7): body `{scope_text | takeoff_ref}` → suggested lines with unit costs, `confidence`, `sources`, `ai_run_id`; never auto-applied |
| GET/POST | `/bid-packages` · nested `/invitations`, `/bids` | `estimating.bid.*` | Sub bidding (FR-EST-6); `POST /bid-packages/{id}/level` → AI bid-leveling table |

---

## 6. Scheduling API (M7)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/projects/{id}/schedule` | `schedule.read` | Active schedule + activities (+deps); ETag-cached by `schedule_version` |
| POST | `/projects/{id}/schedule/baselines` | `schedule.baseline` | Snapshot baseline (FR-SCH-2) |
| GET/POST/PATCH/DELETE | `/schedules/{id}/activities` | `schedule.update` | CRUD; `PATCH /activities:batch` for drag-multiselect |
| PUT | `/activities/{id}/dependencies` | update | Replace dep set; 422 `cycle_detected` |
| POST | `/schedules/{id}/recalculate` | update | CPM run — sync <500 activities, else 202 job |
| GET | `/projects/{id}/lookahead?weeks=3` | read | Lookahead view (FR-SCH-3) |
| GET | `/resources/conflicts?from=&to=` | `schedule.resources` | Cross-project crew/equipment conflicts (FR-SCH-5) |
| POST | `/schedules/{id}/ai/impact` | + AI | Delay simulation (FR-SCH-6): `{delayed_activity_id, days}` → critical-path impact, affected milestones, options, confidence |

---

## 7. Tasks API (M6)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/tasks` | `tasks.task.*` | Filter: project_id, assignee_id, status, kind (`task|punch`), due window. `GET /tasks?filter[assignee_id]=me` = My Work |
| GET/PATCH/DELETE | `/tasks/{id}` | | `If-Match` versioned |
| POST | `/tasks/{id}/comments` | comment | Mentions trigger notifications |
| POST | `/projects/{id}/punch:generate-from-photos` | + AI | Photo AI punch generation (FR-TASK-4): `{photo_ids[]}` → 202 job → draft punch items for review |

---

## 8. Documents API (M3)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/projects/{id}/folders` · `/documents` | `docs.document.*` | Tree + metadata; `?q=` name search |
| POST | `/documents/{id}/versions:initiate` | update | Returns presigned multipart upload (architecture §13) |
| POST | `/documents/{id}/versions:complete` | update | Finalize: checksum verify → version row → scan/extract pipeline (202) |
| GET | `/document-versions/{id}/download` | read | 302 → signed CDN URL |
| GET/POST | `/projects/{id}/drawing-sets` | `docs.drawings.manage` | Issued sets; `POST {id}/publish` pins the field set (FR-DOC-5) |
| GET/POST/PATCH | `/projects/{id}/rfis` | `docs.rfi.*` | Number auto-assigned; status machine enforced |
| GET/POST/PATCH | `/projects/{id}/submittals` | `docs.submittal.*` | Review workflow |
| GET/POST | `/document-versions/{id}/annotations` | comment | Markups |
| POST | `/documents/ai/ask` | + AI | Doc Q&A over permitted docs: `{question, scope:{project_id}}` → answer + source citations (FR-DOC-6) |
| POST | `/drawing-sets/{id}/ai/diff` | + AI | Version diff vs prior set → changed-region report |

---

## 9. Field / Daily Reports API (M8)

> Field clients normally write via the **sync protocol** (§16); these REST endpoints serve office views and integrations. Same use-cases underneath.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/projects/{id}/daily-reports` | `field.dailyreport.*` | Filter: date range, author, status |
| GET/PATCH | `/daily-reports/{id}` | | `POST {id}/submit` locks edits (audited) |
| GET/POST | `/daily-reports/{id}/time-entries` · `/projects/{id}/time-entries` | `field.time.*` | `POST /time-entries:approve` (batch) → cost transactions (FR-FIELD-2) |
| POST | `/photos:initiate` / `:complete` | `field.photo.create` | Resumable upload; EXIF preserved; entity attach `{entity_type, entity_id}` |
| GET | `/projects/{id}/photos` | read | Filter: date, tag, location; GIN-backed `filter[ai_tag]=rebar` |
| GET/POST | `/projects/{id}/field-issues` | `field.issue.*` | `POST {id}/convert` → task or RFI |
| GET | `/daily-reports/{id}/ai-summary` | + AI | Generated narrative (FR-FIELD-6) with edit-before-submit |

**Example (time approval)**

```http
POST /v1/time-entries:approve
Idempotency-Key: 018f…
{ "ids": ["…","…"], "approve": true }

200 { "data": { "approved": 2, "cost_transactions_created": 2 } }
```

---

## 10. Finance API (M9)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/projects/{id}/budget` | `finance.budget.read` | Budget + lines with all money columns (FR-FIN-1); live — no staleness |
| PATCH | `/budgets/{id}/lines/{lineId}` | `finance.budget.update` | Original amounts editable only pre-lock; audited |
| GET | `/projects/{id}/financial-summary` | read | Margin, CTC, FAC, variance (FR-FIN-3) from projections + live lines |
| GET/POST | `/projects/{id}/change-orders` | `finance.co.*` | CO lifecycle |
| POST | `/change-orders/{id}/submit-to-client` | `finance.co.submit` | Publishes to portal + notification |
| POST | `/change-orders/{id}/approve` | `finance.co.approve` (internal) or portal principal via share | Atomic budget+schedule propagation (FR-FIN-2); maker/checker enforced when configured |
| GET/POST | `/invoices` | `finance.invoice.*` | AP+AR unified (`filter[direction]=payable`); 3-way-match state on payable (FR-VEND-2) |
| POST | `/invoices/{id}/approve` → `/payments` | `finance.invoice.approve` / `finance.payment.*` | Approval chains; partial payments |
| GET/POST | `/projects/{id}/payment-applications` | `finance.payapp.*` | AIA-style billing (FR-FIN-4); `POST {id}/generate-pdf` → 202 |
| GET | `/finance/alerts` | read | Margin-erosion & anomaly feed (FR-FIN-6) |
| POST | `/finance/ai/cashflow-forecast` | + AI | `{horizon_weeks}` → projected inflows/outflows + confidence bands (FR-FIN-7) |
| GET/POST | `/integrations/accounting/…` | `admin.integration.manage` | Connect, mapping, sync runs, conflict queue (FR-PLAT-8) |

---

## 11. Procurement, Inventory & Equipment APIs (M5, M10, M11)

### Procurement
| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH | `/suppliers` | Registry + performance (`expand=rating`) |
| GET/POST | `/purchase-orders` | Filter: project, supplier, status, required_by window |
| PATCH | `/purchase-orders/{id}` | Draft edits; state machine on `POST {id}/submit|approve|send|cancel` — approval writes commitment atomically (FR-PROC-3) |
| GET/POST | `/rfqs` · `/rfqs/{id}/quotes` | Quote workflow |
| POST | `/purchase-orders/{id}/deliveries` | Receipt (qty per line, photos) → stock + match state (FR-PROC-4) |
| GET | `/procurement/ai/recommendations` | Buy-timing/lead-time risk feed per project (FR-PROC-5) |
| POST | `/projects/{id}/purchase-orders:draft-from-needs` | AI PO drafting from budget+schedule (FR-PROC-6) → drafts, never sent without human approval |

### Inventory
| GET/POST | `/inventory/items` · `/inventory/locations` | Catalog & locations |
| GET | `/inventory/stock?location_id=&item_id=` | Levels |
| POST | `/inventory/movements` | issue/transfer/adjust (`kind`), validated against stock; issues cost to project (FR-INV-2) |
| GET | `/inventory/reorder-suggestions` | Predictive reorder feed (FR-INV-3) |

### Equipment
| GET/POST/PATCH | `/equipment` | Registry (FR-EQ-1) |
| POST | `/equipment/{id}/assignments` | 409 `overlap` on double-book (DB exclusion) |
| POST | `/equipment/{id}/usage-logs` | Hours/odometer → cost allocation (FR-EQ-2) |
| GET/POST | `/equipment/{id}/maintenance` | Schedules, work orders, inspections (FR-EQ-3) |
| GET | `/equipment/ai/insights` | Idle assets, predictive maintenance, rent-vs-buy (FR-EQ-4) |

---

## 12. Notifications API (M18)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications` | `filter[unread]=true`; cursor-paginated |
| POST | `/notifications:mark-read` | `{ids[] | all_before}` |
| GET/PUT | `/notification-preferences` | Category × channel × digest matrix (FR-PLAT-5) |
| POST | `/devices` | Register push token (FCM/APNs), device metadata |

Realtime delivery via WebSocket (§16.1); this API is the persistence/read-state surface.

---

## 13. AI Assistant API (M17 — contract; behavior in `ai-spec.md`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/conversations` | Open thread with surface context `{module, entity_ref}` |
| POST | `/ai/conversations/{id}/messages` | User message → **SSE stream** response (tokens, tool-call events, final message with `sources[]`, `confidence`, `ai_run_id`) |
| POST | `/ai/search` | NL semantic search (FR-AI-2): `{query, scope?}` → typed results with citations; permission-filtered at retrieval |
| POST | `/ai/actions/{action_id}/confirm` · `/reject` | Human confirmation gate for consequential tool calls (FR-AI-3) |
| GET | `/ai/runs` | Tenant AI audit/usage (`filter[purpose]`, cost aggregates — NFR-27) |
| GET/PUT | `/ai/memories` | User-visible memory management (view/delete) |
| GET/POST/PATCH | `/automations` · `/automations/{id}/runs` | Rule CRUD + run history |

**Example (assistant message)**

```http
POST /v1/ai/conversations/{id}/messages
{ "content": "Which projects are trending under margin this month and why?" }

SSE stream → … final:
{ "role": "assistant", "content": "Two projects are trending under bid margin…",
  "sources": [{ "type": "projection_project_financials", "project_id": "…" }],
  "confidence": 0.87, "ai_run_id": "…" }
```

---

## 14. Reports & Dashboards API (M16)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboards/company` | Executive KPI payload (projections; NFR-4 ≤3 s) |
| GET | `/dashboards/projects/{id}` | Project dashboard aggregate |
| GET/POST/PATCH | `/reports/definitions` | Saved/scheduled reports (FR-EXEC-2) |
| POST | `/reports/definitions/{id}/run` | 202 → job → artifact (PDF/XLSX) in documents |
| GET | `/reports/runs/{id}` | Status + signed download |
| GET | `/exports/{entity}` | Full CSV export per entity (FR-PLAT-7, A8 no lock-in) — 202 job |
| POST | `/imports` | Guided import: upload → `POST /imports/{id}/map` → `/validate` (dry-run report) → `/commit` (202) |

---

## 15. Admin & Permissions API (M18)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST/PATCH | `/admin/users` | `admin.user.manage` | Invite, deactivate (FR-PLAT-10 immediate revocation) |
| GET/POST/PATCH/DELETE | `/admin/roles` | `admin.role.manage` | Custom roles; system roles immutable |
| PUT | `/admin/roles/{id}/permissions` | | Replace grant set; fully audited (FR-RBAC-4) |
| POST | `/admin/users/{id}/roles` | | Company- or project-scoped assignment |
| GET | `/admin/permissions` | read | Permission catalog (drives admin UI) |
| GET/PATCH | `/admin/company` | `admin.company.manage` | Settings, locale, branding, fiscal config |
| GET | `/admin/audit-log` | `admin.audit.read` | Filter: actor, entity, action, date; export |
| GET/POST | `/admin/external-shares` | `admin.share.manage` | Client/sub/supplier grants (FR-RBAC-3) |
| GET/POST/PATCH | `/admin/templates` | `admin.template.manage` | Project/estimate/checklist templates (FR-PLAT-6) |
| GET | `/admin/usage` | `admin.billing.read` | Seats, storage, AI spend |

---

## 16. Realtime, Sync & Webhook APIs

### 16.1 WebSocket
`wss://api.constructionos.com/v1/ws?token=…`
- Client → `{op:"subscribe", scope:"project:{id}"}` (RBAC-checked).
- Server → `{op:"entity_changed", scope, entity_type, entity_id, updated_seq}` — clients refetch via REST (single authz path, architecture §14.1). Also `notification.created`, `job.completed`, presence.

### 16.2 Mobile sync protocol (architecture §14.2)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/mutations` | Batch upload `[{mutation_id, entity, op, changes, base_version, captured_at}]` → per-mutation result `applied|merged|conflict|rejected` (idempotent by mutation_id) |
| GET | `/sync/delta?since_seq=&scopes=` | Keyset delta for working set; tombstones included |
| GET | `/sync/working-set` | Server-computed manifest (projects, drawing set, lookback window) |
| GET | `/sync/conflicts` · `POST /sync/conflicts/{id}/resolve` | Human resolution queue (NFR-12 — never silent loss) |

### 16.3 Webhook API (outbound)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH/DELETE | `/webhooks` | Endpoint CRUD: `{url, secret, event_types[]}` |
| GET | `/webhooks/{id}/deliveries` | Attempt log with response codes |
| POST | `/webhooks/{id}/test` | Signed test event |

Delivery: HMAC-SHA256 signature header (`X-COS-Signature`, timestamped, replay-protected), at-least-once, exponential retries 24 h → dead-letter + notification. Event catalog = the domain event registry (`project.created`, `changeorder.approved`, `dailyreport.submitted`, `invoice.approved`, `incident.reported`, `job.completed`, …) — versioned, documented, additive.

---

## 17. OpenAPI

The normative machine-readable contract is generated from code (`pnpm api:openapi` → `openapi.json`) and published at `/v1/openapi.json` + hosted reference docs. This document governs intent; generated OpenAPI governs exact shapes; CI fails if they diverge from the zod schemas.

---

*End of `api.md` v1.0.*
