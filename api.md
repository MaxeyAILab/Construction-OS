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
| POST | `/auth/login` | Password login | **Public.** Returns access+refresh; `mfa_required` → step-up. If the account belongs to more than one company and `company_id` is omitted, `409 ambiguous_company` — `error.details.companies` lists `{company_id, company_name, company_slug}` for every membership so the client can prompt a picker and retry with `company_id` set (FR-PLAT-9 §15.7) |
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

### 2.1 Enterprise SSO (SAML) + SCIM provisioning (FR-PLAT-2, `architecture.md` §11, roadmap "SSO (SAML/OIDC) + SCIM provisioning")

Connection admin (a tenant configures its own IdP; not a global setting):

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/sso/connections` | `admin.sso.manage` | List / create `{name, idp_entity_id, idp_sso_url, idp_certificate, default_role_id, attribute_mapping?}` |
| PATCH/DELETE | `/sso/connections/{id}` | `admin.sso.manage` | Update config / remove — only future logins are affected, existing sessions are untouched |
| POST | `/sso/connections/{id}/rotate-scim-token` | `admin.sso.manage` | Issue a new SCIM bearer token, invalidating the prior one; shown in the response **once** |

Login flow (public — the caller has no session yet):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/sso/{connectionId}/metadata` | SP metadata XML, pasted into the IdP's admin console |
| GET | `/auth/sso/{connectionId}/login` | `302` to the IdP's SSO URL with a signed `AuthnRequest` (SP-initiated) |
| POST | `/auth/sso/{connectionId}/acs` | Assertion Consumer Service: validates the `SAMLResponse`, finds-or-JIT-provisions the user by email, returns the same access/refresh pair as `POST /auth/login` |

SCIM 2.0 (RFC 7643/7644) — bearer-token-authenticated with the connection's own SCIM token, **not** a company session or `X-Api-Key`:

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/scim/v2/Users` | List (`filter=userName eq "..."`) / create — creation assigns `default_role_id` from the owning connection |
| GET/PATCH/PUT/DELETE | `/scim/v2/Users/{id}` | Read; partial update (`{"active": false}` deprovisions); replace; hard deprovision (removes the company membership — never deletes the global `users` row, same identity-is-global model as every other cross-tenant user) |
| GET | `/scim/v2/Groups` | Read-only: one SCIM Group per tenant role, `members[]` = current assignees |
| PATCH | `/scim/v2/Groups/{id}` | Replace `members[]` — assigns/revokes the mapped role via `RbacService`'s existing apply methods, so §10.2 maker-checker still applies if the tenant has it enabled |

- **Protocol scope:** SAML 2.0 only for this row. `architecture.md` §11 also names OIDC, but Okta/Entra both support SAML universally, so SAML alone satisfies the enterprise requirement — OIDC is a **flagged follow-up**, not built now, to avoid doubling the identity-federation surface in one pass.
- **JIT provisioning:** a first-time SSO login creates a `users` row with `password_hash = null` — that account can only ever authenticate through that connection's `/acs` endpoint (password login fails the existing `!user.passwordHash` check) until an admin separately sets a password.
- **SCIM token format & storage:** mirrors §16.4's API-key design exactly — `scim_<tenant_id>.<32 random bytes, base62>`, SHA-256 hashed, tenant id recoverable from the visible prefix so authentication runs inside that tenant's own RLS scope (`database.md` §2 — no bypass path exists here either). One active token per connection; rotating replaces it, same "a replacement is a new key" posture as §16.4.
- **Rate limit:** SCIM traffic is bursty at initial directory sync — the existing "API key (integration): 600 req/min" tier (§1.6) applies.

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
| GET | `/schedules/{id}/ai/risk` | `schedule.read` | Critical-path risk scoring (FR-SCH-6, ai-spec.md §7.5 "float burn-rate"): per-activity float trend vs. the latest baseline → risk level, projected days until the activity goes critical at its current burn rate |

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
| POST | `/dashboards/company/what-if` | What-if simulation (FR-EXEC-4, ai-spec.md §7.1 "what-if sketches"; roadmap.md Phase 3 "bid loss, crew moves, delay cascades") — `dashboard.company.read`. Rule-computed, AI-narrated: numbers come from CPM re-runs / pipeline math, never a model guess |
| POST | `/dashboards/company/briefing` | Generate an Executive Briefing now (FR-EXEC-3, ai-spec.md §7.1 "weekly proactive briefing"; §15.6 Executive Briefing Agent runs this same call weekly) — `dashboard.company.read`. Persists a snapshot; rule-computed anomaly counts, AI-narrated summary |
| GET | `/dashboards/company/briefings` | Briefing history (FR-EXEC-3) — `dashboard.company.read`. The "portal card" surface: most recent briefings, newest first |
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
| GET/PATCH | `/admin/company` | `admin.company.manage` | Settings, locale, branding, fiscal config; `PATCH` also accepts `parent_company_id` (FR-PLAT-9 §15.7) |
| GET | `/admin/company/children` | `admin.company.manage` | List this company's direct holding-structure children (FR-PLAT-9 §15.7) |
| GET | `/admin/audit-log` | `admin.audit.read` | Filter: actor, entity, action, date; export |
| GET/POST | `/admin/external-shares` | `admin.share.manage` | Client/sub/supplier grants (FR-RBAC-3) |
| GET/POST/PATCH | `/admin/templates` | `admin.template.manage` | Project/estimate/checklist templates (FR-PLAT-6) |
| GET | `/admin/usage` | `admin.billing.read` | Seats, storage, AI spend |

### 15.1 Agent identities (`ai-spec.md` §15, roadmap "Agent runtime GA: identities, budgets, kill-switch, admin surface")

`ai-spec.md` §15 is explicit that "the tool registry, consequence classes, and audit spine... are already the agent runtime — no re-architecture, only new agent definitions." This row is exactly that remaining scaffolding: declaring an agent as a first-class, admin-visible identity, not a new execution engine. It does **not** ship any of the "planned agents" (Procurement/Billing/Compliance/Closeout) — those are separate, individually-prioritized roadmap rows that would be built *on top of* this once selected.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET/POST | `/admin/agents` | `admin.agent.manage` | List (with this-month budget usage) / declare `{name, purpose, role_id, tool_allowlist[], budget_monthly_usd?, escalation_contacts?}` |
| GET/PATCH | `/admin/agents/{id}` | `admin.agent.manage` | Read; update purpose, tool allowlist, budget, escalation contacts (role/permission changes go through the normal `/admin/users/{id}/roles` path, same as any other identity) |
| POST | `/admin/agents/{id}/pause` · `/resume` | `admin.agent.manage` | Kill-switch (`ai-spec.md` §15: "human 'pause agent' kill-switch per tenant") — reversible, always audited |
| DELETE | `/admin/agents/{id}` | `admin.agent.manage` | Decommission: revokes the agent's role assignment and deactivates its identity; the underlying `users`/`ai_runs` history is retained (nothing about an agent's past actions is ever deleted) |

- **An agent is a `users` row, not a new principal type:** created with no `password_hash` (unreachable via `/auth/login`, same shape as an SSO-provisioned account) and `company_users.kind = 'agent'`. Its "permission_set (narrow, explicit)" (`ai-spec.md` §15) is an ordinary role assignment via the existing RBAC tables — reusing every permission-resolution, audit, and maker-checker path a human user already goes through, per architecture.md §12's "not a parallel authorization system" precedent.
- **Attribution:** every action an agent takes is emitted with `actor_id` = the agent's `users.id` and `actor_type = 'ai'` on the outbox row — a column pair that already exists (`outbox.actor_type` check constraint already includes `'ai'`) and already flows into `audit_log` unmodified.
- **Tool allowlist:** `tool_allowlist[]` entries are validated against the live tool-runner registry (`ai-spec.md` §6) at declare/update time, the same "validate against the real catalog, don't invent a parallel enum" precedent as API-key `scopes[]` (§16.4).
- **Budget:** `budget_monthly_usd` is compared against that agent's own `ai_runs.cost_usd` for the current month (same computed-on-demand approach as the tenant-level `ai_budgets` row in `ai-spec.md` §2, just narrower) — informational at this stage (no live agent execution loop exists yet to enforce it against), but the same computation an actual agent implementation calls before acting.

### 15.2 Procurement Agent (`ai-spec.md` §15, roadmap "Procurement Agent (draft→act ladder)")

The first concrete "planned agent" built on §15.1's scaffolding. No new endpoints — it is a background process, not a human-facing surface; it is declared and administered entirely through the existing `/admin/agents` CRUD by giving an agent's `tool_allowlist[]` the `draft_and_route_purchase_orders` entry.

- **Trigger:** a daily (00:00 UTC) tick, the first genuinely scheduled (not on-demand or event-consumer) background job in this codebase, alongside the existing `outbox-relay` repeatable job's pattern.
- **Per tick, per active agent whose `tool_allowlist` contains `draft_and_route_purchase_orders`:** `assertCanAct` (kill-switch + budget gate) first — a paused or over-budget agent is skipped for the day, not retried mid-tick. Agent roles are always company-scoped (§15.1's `POST /admin/agents` only offers company-scoped assignment), so "watch schedule/stock" is every `active`-status project in the tenant — no separate "watched projects" list.
- **Per project:** calls the existing `ProcurementNeedsService.draftFromNeeds` (§11's `POST /projects/{id}/purchase-orders:draft-from-needs`) unchanged, under the agent's own identity as actor. "Route" means each drafted PO is immediately submitted into the human approval queue (the existing `POST /purchase-orders/{id}/submit` transition) — not sent to the supplier. Sending remains a human-executed action, per `ai-spec.md` §7.4's autonomy ceiling for Procurement AI ("`act` (send PO) restricted to human execution").
- **Attribution:** every `purchase_order.created.v1`/`purchase_order.updated.v1` event this produces carries `actor_id` = the agent's `users.id` and `actor_type = 'ai'`, same guarantee as §15.1.
- **Explicit scope cut:** `escalation_contacts` notification on a skipped/blocked tick (paused, over budget, or a need with no historical supplier) is not wired up this pass — those are raw emails with no platform-user record, and the Notifications module is keyed to internal users. The run still leaves a complete, attributed audit trail either way; a real notification path is a self-contained follow-up.

### 15.3 Billing Agent (`ai-spec.md` §15, roadmap "Billing Agent (monthly pay-app assembly)")

The second concrete "planned agent," built the same way as §15.2: no new endpoints, declared via `/admin/agents` with `assemble_and_route_pay_applications` in `tool_allowlist[]`.

- **Trigger:** a monthly tick (00:00 UTC on the 1st), a second `repeat`-pattern BullMQ job alongside §15.2's daily one — same infrastructure, different cron pattern.
- **Progress source — a genuine spec gap, resolved here, not before:** there is no existing percent-complete-by-cost-code concept anywhere in Budget/Finance (payment application lines are pure dollar amounts). The only percent-complete field in the system is `schedule_activities.percent_complete`, linked to a cost code by an **optional, many-to-one** `cost_code_id`. This section defines the rollup: a cost code's percent complete is the unweighted mean of `percent_complete` across every non-deleted activity on the project's active schedule referencing that cost code. A cost code with zero linked activities produces no line and is left for a human to bill manually — it is not treated as 0% or skipped-with-error.
- **Per tick, per active agent whose `tool_allowlist` contains `assemble_and_route_pay_applications`:** `assertCanAct` first, same kill-switch/budget gate as §15.2. Scope is every `active`-status project in the tenant (agent roles are company-scoped, same reasoning as §15.2).
- **Per project:** reads the active budget's lines (`GET` equivalent of §9's budget-with-lines) for each cost code's current `scheduled_value` (its `revised_amount`) and the project's active schedule (§6) for the percent-complete rollup above; reads the most recent non-`void` payment application (if any) for `previous_completed` per cost code (its prior `completed_to_date`), defaulting to zero where none exists. `this_period = round(percent_complete/100 × scheduled_value) − previous_completed`, clamped to zero — a cost code with no forward progress this period produces no line. If no cost code produces a positive line, the project is skipped for this tick (no empty pay app created). Otherwise `POST /projects/{id}/payment-applications` (§10) is called under the agent's own identity with `period_end_date` = the tick's run date, immediately followed by `POST /payment-applications/{id}/submit` — "route" means the human approval queue, identical meaning to §15.2's "route," never `approve` (which bills the client).
- **Attribution:** `payment_application.created.v1` carries `actor_id` = the agent's `users.id` and `actor_type = 'ai'`, same guarantee as §15.1/§15.2. (`submit` itself emits no outbox event today, for any actor — a pre-existing gap, not introduced here.)
- **Explicit scope cuts:** `materials_stored` and `retainage_pct` are left at their schema defaults (`0.00`) — there is no stored-materials tracking or per-tenant retainage-rate configuration anywhere in the system to source them from. The human approver is the backstop for both, the same segregation-of-duties gate that already exists on every payment application regardless of who drafted it.

### 15.4 Compliance Agent (`ai-spec.md` §15, roadmap "Compliance Agent (cert/insurance chasing)")

The third concrete "planned agent," declared via `/admin/agents` with `chase_expiring_subcontractor_compliance` in `tool_allowlist[]`. One new endpoint: `GET /compliance/alerts | safety.certification.read | Compliance alert feed (cert/insurance expiring or expired)`.

- **Trigger:** a daily tick (00:00 UTC), same infrastructure as §15.2 — cert expiry is date-driven, so daily freshness matters the way a monthly cadence wouldn't.
- **Due-state source — reused, not reinvented:** `CertificationsService.dueState`/`list({expiringOnly: true})` (FR-SAFE-2, already built for the Safety module's own expiry alerts and FR-SUB-2's bid/subcontract eligibility gating) already computes `valid`/`expiring_soon`/`expired` on a 30-day window. This agent adds no new due-state logic — it reads the same computation everyone else already reads.
- **Per tick, per active agent whose `tool_allowlist` contains `chase_expiring_subcontractor_compliance`:** `assertCanAct` first, same kill-switch/budget gate as §15.2/§15.3. Scope is every certification in the tenant whose `holder_subcontractor_id` is set (a user-held certification, e.g. a crew member's OSHA card, is Safety's own concern, not this agent's — "sub compliance" per the roadmap dependency, not all compliance) — no project scoping, since neither subcontractors nor certifications are project-scoped rows.
- **Per expiring-or-expired certification:** if a `compliance_alerts` row doesn't already exist for this exact `(certification_id, due_state)` pair, one is inserted (with `expires_at` and the certification/subcontractor it's about) and `compliance_alert.raised.v1` is emitted with `actor_id` = the agent's `users.id`, `actor_type = 'ai'` — the dedupe means a still-expiring cert produces exactly one alert per state transition, not one every day it stays expiring. `compliance_alerts` is append-only (same immutable, `FORCE ROW LEVEL SECURITY` shape as `finance_alerts`) — a renewed certification's next `list()` call simply stops reporting it as due, it doesn't retract the historical alert.
- **Explicit scope cut — the literal "chase... with sub-portal messages" half of the spec is not built this pass.** There is no subcontractor-facing message channel in the codebase today: `portal_messages` (Client Portal v1) hardcodes `audience = 'client'` on every insert, and no supplier/subcontractor equivalent exists despite the schema's `audience` check constraint already anticipating one. Actually sending something to a subcontractor is real, separate feature work — a new external-facing channel with its own access-control story — not something an agent wiring pass invents as a side effect. This agent's output is the complete, queryable, attributed alert feed (`GET /compliance/alerts`); a human chases from it today, same as they would from `GET /finance/alerts`. The roadmap's own success metric ("expired-doc incidents → 0") depends on the actual chase, which remains a self-contained follow-up once a subcontractor portal messaging channel exists.

### 15.5 Closeout Agent (`ai-spec.md` §15, roadmap "Closeout Agent (O&M/warranty package)")

The fourth concrete "planned agent" — the first one built entirely on top of a module (M19, §18) shipped within this same expansion rather than an older Phase 1/2 module. Declared via `/admin/agents` with `assemble_closeout_package` in `tool_allowlist[]`. No new endpoint at all (not even the "same action, agent-triggered" shape §15.2–§15.4 use) — see below for why.

- **Trigger:** a daily tick (00:00 UTC), same infrastructure as §15.2/§15.4 — there's no event to react to (a checklist item or punch item reaching its final state doesn't itself signal "the project might be closeout-ready now"), so a periodic sweep is the simplest correct trigger.
- **Per tick, per active agent whose `tool_allowlist` contains `assemble_closeout_package`:** `assertCanAct` first, same kill-switch/budget gate as every agent above. Scope is every project in the tenant whose `status` is `closed` or `warranty` (`database.md`'s project status enum already anticipates exactly this post-construction phase) — an `active` or `planning` project is never closeout-ready, so scoping here avoids re-checking hundreds of irrelevant projects daily.
- **Per project:** skip immediately if `GET`-equivalent `CloseoutPackagesService.getStatus` already shows a non-empty assembly history — this agent only catches the *first* moment a project becomes ready, exactly once; a later re-assembly (e.g. after a checklist item is corrected post-handover) is a deliberate human action via `:assemble`, not something the agent repeats indefinitely. Otherwise it calls `CloseoutPackagesService.assemble` under its own identity — the identical call `POST /projects/{id}/closeout/package:assemble` makes — and if that throws `checklist_incomplete` or `punch_list_open` (409, §18), the project simply isn't ready yet; the agent swallows both and moves to the next project, to be retried on tomorrow's tick.
- **No draft→act ladder, unlike §15.2/§15.3:** assembling a package has no external effect — it's an internal bundle a human still has to hand to the owner (§18's own delivery scope-cut) — so there is nothing consequential to gate behind a human approval step. This agent runs at `act` from day one, the same posture §15.4's alert-raising already established for a non-consequential, fully-internal write.
- **Attribution:** `closeout_package.assembled.v1` carries `actor_id` = the agent's `users.id` and `actor_type = 'ai'`, same guarantee as every agent above — indistinguishable in the audit log from a human-triggered assembly except by that field.
- **Explicit scope cut:** handing the assembled package to the owner (a portal download, an email with the file attached) is Client Portal (M13) surface work that doesn't exist yet for this module at all (§18) — this agent inherits that gap unchanged rather than working around it. The roadmap's own success metric ("closeout time ↓ 50%") is measured from checklist-ready to package-in-hand for the PM, which this agent already delivers; the owner-facing handoff is a separate, self-contained follow-up.

### 15.6 Executive Briefing Agent (`ai-spec.md` §7.1 Executive Assistant, roadmap.md Phase 3 "Executive Assistant full... proactive briefings")

The fifth concrete "planned agent," declared via `/admin/agents` with `generate_executive_briefing` in `tool_allowlist[]`. No new endpoint of its own — it calls the same `POST /dashboards/company/briefing` (§14) a human's on-demand generate button calls, under its own identity, same "no side door, same use-case as a human" precedent as every agent in this section.

- **Trigger:** a weekly tick (00:00 UTC Monday), the first weekly (not daily/monthly) `repeat`-pattern BullMQ job in this codebase, alongside §15.2–§15.5's daily/monthly ones — matching ai-spec.md §7.1's own "weekly proactive briefing" cadence.
- **Per tick, per active agent whose `tool_allowlist` contains `generate_executive_briefing`:** `assertCanAct` first, same kill-switch/budget gate as every agent above. Agent roles are company-scoped, so this runs once per tenant with an active Executive Briefing Agent, not per project.
- **Composition — rule computes fact, AI narrates, same split as every AI feature in this spec:** the briefing aggregates already-built primitives rather than deriving new anomaly logic — `FinanceAlertsQueryService.list` (open `margin_erosion`/`invoice_duplicate` alerts), `PredictiveScheduleRiskService.computeRisk` (looped over every `active`-status project's master schedule, counting `critical`/`high` items), `OpportunitiesService.listOpenForPipeline` (weighted pipeline value), and `CashflowForecastService.forecast` (net cash flow, 4-week horizon). The AI Gateway call turns those numbers into a short executive narrative; a failed/unconfigured model call degrades to a `null` narrative, never to a skipped briefing.
- **Persistence + notification:** each generated briefing is a new, immutable `company_briefings` row (never updated in place — a durable weekly history, the "portal card" surface). `company_briefing.generated.v1` fires with `actor_id` = the agent's `users.id`, `actor_type = 'ai'`, and `notify_user_id` = the agent's `created_by` (the human who declared it) — a single named recipient, not yet a fan-out to everyone holding `dashboard.company.read` (same v1 scope cut as §15.2's own unwired `escalation_contacts` notification: a real broader-audience fan-out is a self-contained follow-up).
- **Attribution:** `company_briefing.generated.v1` carries `actor_id`/`actor_type = 'ai'` same guarantee as every agent above — a human's own on-demand `POST .../briefing` call produces an identical row/event under their own identity, indistinguishable in shape except by that field.

### 15.7 Multi-company / holding structures (spec.md FR-PLAT-9 "should", roadmap.md Version 2 "one owner operates several tenants")

Deliberately minimal: a *linking* and *enumeration* primitive, not a cross-company access model. Setting `parent_company_id` never grants the parent's members any permission inside the child (or vice versa) — every request still runs under exactly one tenant's RLS scope, per the token it was issued for (§1.1, §2). A holding company reads a child's own data today the same way anyone does: by holding a separate membership (and its own JWT) in that child company. This section only makes the *grouping* itself representable and discoverable.

- `PATCH /admin/company` (`admin.company.manage`, §15) accepts an additional optional field: `parent_company_id` (uuid, nullable — `null` clears an existing link). The `companies.parent_company_id` self-FK (database.md §7) already exists for this, nullable/unused before this section. Validated against three rejections, all `422 invalid_parent_company`:
  - **Self-parent:** `parent_company_id` equal to the caller's own tenant.
  - **Not a member:** the acting user must also hold an active `company_users` membership in the target parent company (checked via the same `get_user_company_memberships` lookup login's ambiguous-company resolution already uses, migration 0003) — "one owner operates several tenants" means the *owner* declares the link from a company they belong to on both ends, not an arbitrary third party claiming a parent.
  - **Cycle:** the target parent's own ancestor chain (walked one row at a time via `parent_company_id` — `companies` is the one table with RLS deliberately disabled, database.md §7, since it IS the tenant boundary rather than tenant-owned data, so no SECURITY DEFINER bypass is needed here) must not already contain the caller's tenant — rejects a link that would close a loop.
  - A successful change reuses `company.updated.v1` (§15's existing PATCH event, already audit-mapped) with `parent_company_id` included in `changed_fields` — no new event type for what is, mechanically, one more settable field on the same row.
- `GET /admin/company/children` (`admin.company.manage`) lists the caller's own tenant's direct children (`{company_id, company_name, company_slug}[]`, ordered by name) — never an arbitrary company's children, and never the full multi-level tree (a holding company walks one level at a time, same as clicking into a folder).

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

### 16.4 Public API: API keys (NFR-23, roadmap "Public API GA")

`database.md` §7's `api_keys` table (`name`, `key_hash`, `scopes[]`, `last_used_at`, `revoked_at`) is the server-to-server counterpart to §1.1's `X-Api-Key` auth scheme — this section is that table's CRUD surface.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api-keys` | `admin.apikey.manage` | List keys, redacted (`name`, `scopes`, `last_used_at`, `created_at`, `revoked_at`) — the raw key is never returned again after creation |
| POST | `/api-keys` | `admin.apikey.manage` | Create `{name, scopes[]}` → `201` body includes the raw key **once**; only its hash is ever persisted |
| DELETE | `/api-keys/{id}` | `admin.apikey.manage` | Revoke (sets `revoked_at`) — immediate and irreversible, same posture as session revocation (FR-PLAT-10); a replacement is a new key, not an un-revoke |

- **Scopes, not a new permission type:** each entry in `scopes[]` is one of the existing `module.resource.action` catalog keys (§1.1, `architecture.md` §12) — same "workflow/config on top of permissions, not a parallel authorization system" precedent already used for maker/checker (§10.2). A request authenticated via `X-Api-Key` is authorized against the *intersection* of the key's scopes and its owning user's own current permissions, so a key can never grant more access than its creator already holds (same ceiling logic as external-share scoping, FR-RBAC-3) — if the creator's access is later reduced, every key they hold is reduced with it.
- **Key format & storage:** raw key is `cos_live_<tenant_id>.<32 random bytes, base62>`, shown exactly once in the `POST` response; `key_hash` is SHA-256 of the full raw string, not Argon2id (FR-PLAT-2's password hashing) — password auth always looks a user up by email *before* verifying a hash, but an incoming API request carries only the raw key itself. Database.md §2's tenant isolation is enforced at the row-security level with no bypass path (`FORCE ROW LEVEL SECURITY`, `app.tenant_id` session variable) even for this bootstrap lookup, so the tenant id has to be recoverable from the key *before* querying `api_keys` — hence the visible (non-secret) tenant-id segment, parsed first so the actual hash lookup runs inside that tenant's own RLS scope like every other query in this system. Embedding it is safe: a company UUID isn't sensitive on its own, and correctness still depends entirely on the random secret half. SHA-256 (not a salted/slow hash) is what makes a direct `WHERE key_hash = …` lookup possible at all — safe specifically because a generated key already has ≥256 bits of entropy, unlike a human-chosen password, so the slow/salted properties Argon2id exists for aren't needed. A lost key cannot be recovered — only revoked and replaced.
- **Rate limit:** the existing "API key (integration): 600 req/min" tier (§1.6) applies unchanged.
- **Out of scope for this row:** per-key IP allowlists, scoped expiry dates, and a sandbox/test-mode key prefix are deferred until a real integration partner asks for one — the schema's `scopes[]`/`revoked_at` shape doesn't need to change to add them later.

---

## 17. OpenAPI

The normative machine-readable contract is generated from code (`pnpm api:openapi` → `openapi.json`) and published at `/v1/openapi.json` + hosted reference docs — this *is* the "docs portal" half of the roadmap's "Public API GA" row; there is no separate hand-authored portal to build. This document governs intent; generated OpenAPI governs exact shapes; CI fails if they diverge from the zod schemas.

Official TS/Python SDKs (the other half of that roadmap row) are thin typed clients generated from this same OpenAPI contract, not a hand-written API surface of their own — tracked as a packaging/release-process follow-up once the contract is stable enough to commit to backward-compatible client libraries, not as new endpoints in this document.

---

## 18. Warranty & Closeout API (M19)

New top-level section, not a renumbering of an existing one — every other section number in this document is cited by exact `§X.Y` from committed code comments (agents module, config, schema files), so inserting a section earlier and shifting everything after it would silently invalidate all of them. §18 is simply the next unused number.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/projects/{id}/closeout/checklist` | `closeout.checklist_item.read` | Checklist items: category, status (`pending`/`complete`/`not_applicable`), linked document (FR-CLOSE-1) |
| POST | `/projects/{id}/closeout/checklist` | `closeout.checklist_item.create` | Add a tenant-defined item beyond the standard categories |
| PATCH | `/closeout/checklist/{id}` | `closeout.checklist_item.update` | Set status / link a supporting document (`document_id`, from §8) |
| GET | `/projects/{id}/closeout/package` | `closeout.package.read` | Current package status (`draft`/`assembled`/`delivered`) and assembly history |
| POST | `/projects/{id}/closeout/package:assemble` | `closeout.package.assemble` | Bundles every checklist item's linked document into one deliverable; `409` if any checklist item is still `pending` or any punch item (§7) on the project is still open (FR-CLOSE-2/3) |
| GET | `/projects/{id}/warranties` | `closeout.warranty.read` | Per-scope warranty records with computed due-state (`active`/`expiring_soon`/`expired`), same on-read projection pattern as Safety's certifications (FR-SAFE-2) and Equipment's maintenance schedules (FR-EQ-3) — not a stored/maintained column |
| POST | `/projects/{id}/warranties` | `closeout.warranty.create` | `{scope, warranty_type, responsible_party, start_date, duration_months, document_id?}` (FR-CLOSE-4) |
| PATCH | `/warranties/{id}` | `closeout.warranty.update` | Amend responsible party / duration / linked document |
| GET | `/warranties/{id}/claims` | `closeout.claim.read` | Claim lifecycle history |
| POST | `/warranties/{id}/claims` | `closeout.claim.create` **or** portal principal via share on the warranty's project (client submission) | `{description}` → `status: submitted`; dual-path authorization, same "internal permission OR share" shape as Change-Order approval (§10) — `403` outside the warranty's active period |
| PATCH | `/claims/{id}` | `closeout.claim.update` | Internal-only lifecycle transitions: `submitted → acknowledged → in_progress → resolved`\|`rejected` |

No separate AI endpoint (FR-CLOSE-6, §15.5 Closeout Agent): assembling a package has no external effect of its own (see the delivery scope-cut below), so there's nothing for a draft→act ladder to gate — the Closeout Agent calls the exact same `:assemble` action under its own identity, same "no side door, same use-case as a human" precedent as every agent in §15.

- **Gating is the whole point (FR-CLOSE-2):** `:assemble` re-derives readiness from live checklist + punch state on every call — there is no separate "readiness" flag to fall out of sync. The same rule applies whether a human or the Closeout Agent triggers it.
- **Warranty due-state reuses, not reinvents:** the `active`/`expiring_soon`/`expired` vocabulary and the on-read (not stored) computation are the same shape already established for certifications and equipment maintenance — a new due-state concept here would be an unjustified third implementation of the same idea.
- **Claims are the only client-write surface this module adds**, and only within the dual-path pattern every other portal write already uses (§10's CO approval, and the supplier-portal PO confirmation code implements the same shape though api.md doesn't separately document it) — no new authorization mechanism.
- **Delivery to the client is out of scope for this row:** `:assemble` produces the bundle; actually notifying/handing it to the owner (e.g., a portal download or an email with the package attached) is Client Portal (M13) surface work layered on top once M19 ships, not part of this spec.

---

*End of `api.md` v1.0.*
