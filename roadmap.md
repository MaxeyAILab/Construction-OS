# ConstructionOS — Product Roadmap (`roadmap.md`)

> **Document type:** Delivery roadmap & sequencing specification
> **Status:** Draft v1.0
> **Traces to:** `spec.md` (§16 MVP scope, §17 roadmap shape), all companion documents
> **Sprint length:** 2 weeks. Estimates assume a founding team of ~8–10 engineers (2 platform, 3 product, 1 mobile-lead+1, 1 AI, 1 design-eng) and will be re-baselined each phase.
> **Legend:** Priority P0 (phase-defining) / P1 (committed) / P2 (stretch). Value & Complexity: L/M/H/VH. Risk: L/M/H.

---

## Phase 1 — MVP (Foundation & Wedge) · ~Sprints 1–16 (8 months)

**Objective:** prove the thesis — unification + field-first + embedded AI (spec §16). Exit criteria are spec §16.4, non-negotiable.

### 1A. Platform Foundation (Sprints 1–5)

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| Monorepo, CI/CD, envs, IaC (arch §19) | P0 | H | M | — | 1.5 | deploy-to-prod < 15 min, trunk green | L |
| Multi-tenant core: companies, users, RLS, sessions (db §2,7) | P0 | VH | H | repo | 2 | cross-tenant probe suite: 0 leaks | M |
| AuthN: email+MFA, refresh rotation, magic link | P0 | H | M | tenant core | 1.5 | auth p95 < 200 ms | L |
| RBAC: roles/permissions/guards + admin UI (spec §10) | P0 | VH | H | auth | 2 | 100% endpoints permission-gated (CI check) | M |
| Outbox → NATS event backbone + BullMQ workers (arch §8–9) | P0 | H | M | tenant core | 1.5 | event relay lag p95 < 2 s | M |
| Notification service (in-app + email + push) | P0 | H | M | events | 1.5 | delivery success > 99.5% | L |
| Audit log spine | P0 | H | L | events | 0.5 | all privileged actions logged | L |
| Design system v1: tokens, 20 core components, dark/light (ui §2–3) | P0 | H | M | repo | 3 (parallel) | a11y CI green; component reuse > 80% | L |
| Observability: OTel, dashboards, SLOs (arch §15) | P0 | M | M | infra | 1 | MTTD < 5 min on injected faults | L |
| File pipeline: presigned uploads, scan, thumbnails (arch §13) | P0 | H | M | tenant core | 1.5 | 50 MB upload success on 3G profile | M |

### 1B. Core Product Wedge (Sprints 5–12)

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| Projects module: CRUD, cost codes, teams, templates, command center (M4) | P0 | VH | M | 1A | 2 | project setup < 30 min (NFR-21 path) | L |
| Budget & cost ledger: budget lines, commitments, cost transactions, live margin (M9 core) | P0 | VH | H | projects | 3 | margin matches accounting in pilot ±1% | H |
| Estimating v1: lines, assemblies, cost book, versions, → budget conversion (M2) | P0 | VH | H | budget | 2.5 | estimate→budget zero re-entry demo | M |
| Change orders with budget/schedule/client propagation | P0 | VH | M | budget | 1.5 | CO cycle time measured; propagation atomic | M |
| Documents v1: folders, versioning, drawing sets, viewer (M3) | P0 | H | H | file pipeline | 2.5 | wrong-version incidents = 0 in pilot | M |
| RFIs v1 | P1 | M | L | documents | 1 | RFI lifecycle tracked e2e | L |
| Tasks & punch (M6) | P0 | H | M | projects | 1.5 | field task completion rate visible | L |
| Scheduling v1: Gantt, dependencies, CPM, baselines (M7) | P0 | H | VH | projects | 3 | 500-activity schedule interactive < 100 ms | H |
| Client portal v1: progress view, CO/selection approvals (M13) | P0 | H | M | CO, photos | 1.5 | client approval < 48 h median in pilot | M |
| Executive dashboard v1 + projections (M16) | P1 | H | M | budget, events | 1.5 | dashboard p95 < 3 s (NFR-4) | L |
| QuickBooks two-way sync (FR-PLAT-8) | P0 | VH | H | budget, invoices | 2.5 | reconciliation diff = 0 on pilot books | H |
| Imports (CSV guided) + full export | P1 | H | M | modules above | 1.5 | pilot data migrated < 1 day (NFR-21) | M |

### 1C. Field & Mobile (Sprints 6–14, parallel track)

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| Mobile app shell: auth, nav, offline SQLite store (arch §6) | P0 | VH | H | 1A | 2 | cold start < 2 s | M |
| Sync engine: mutation log, delta pull, conflict UX (arch §14.2) | P0 | VH | VH | shell, events | 3 | **0 data loss**; sync success > 99.9% | **H** |
| Daily reports + time + weather (offline) | P0 | VH | M | sync | 2 | report filing < 2 min (persona Marco) | M |
| Photo capture pipeline (offline, EXIF, resumable) | P0 | H | M | sync, files | 1.5 | photo loss = 0; upload success > 99.5% | M |
| Field tasks/punch + drawing viewer offline | P0 | H | H | sync, documents | 2 | field WAU ≥ 60% in pilot crews | M |
| Field UX hardening: high-contrast, 52 px targets, voice notes | P1 | M | L | above | 1 | SUS ≥ 80 from field testers | L |

### 1D. Embedded AI v1 (Sprints 10–16)

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| AI gateway + ai_runs audit + budgets (ai §2) | P0 | H | M | 1A | 1.5 | 100% runs metered & attributed | L |
| RAG pipeline + NL search (ai §3, 7.11) | P0 | H | H | gateway, events | 2.5 | search success > 60%; 0 permission leaks | M |
| Project Assistant (read+draft) (ai §7.2) | P0 | VH | H | RAG, tools | 2.5 | ≥ 3 AI features weekly-used in pilot (exit criterion) | M |
| Photo AI tagging + punch drafts (ai §7.8) | P1 | H | M | photo pipeline | 1.5 | tag precision ≥ 90%; punch acceptance ≥ 50% | M |
| Daily-report AI summary | P1 | M | L | assistant | 0.5 | summary acceptance ≥ 70% | L |
| Margin-erosion alerts v1 (rule+AI hybrid) | P1 | VH | M | budget ledger | 1 | alert lead time ≥ 14 days median | M |

**Phase 1 pilot program:** 3–5 design-partner GCs live from Sprint 12; weekly on-site field research; exit review against spec §16.4 gates GA.

---

## Phase 2 — Operational Depth · ~Sprints 17–28 (6 months)

**Objective:** replace the remaining disconnected tools (spec G1); expand AI from assistant to operator-with-confirmation.

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| CRM & pipeline (M1) + opportunity→project | P0 | H | M | platform | 2 | pipeline adoption ≥ 70% of tenants | L |
| Procurement full: RFQ→PO→delivery, supplier registry (M5) | P0 | VH | H | budget | 3 | PO cycle time ↓ 40% vs baseline | M |
| Inventory: items, locations, movements, costing (M10) | P1 | M | M | procurement | 2 | stockout incidents ↓ 50% | M |
| Equipment: registry, assignment, usage→costing, maintenance (M11) | P1 | M | M | budget | 2 | utilization visible for 100% assets | L |
| Safety: forms, toolbox talks, incidents, certifications (M12) | P0 | H | M | field, mobile | 2 | incident report < 5 min; cert-expiry misses = 0 | L |
| Subcontractor mgmt: prequal, bids, subcontracts, compliance gating (M14) | P0 | H | H | procurement, docs | 2.5 | sub compliance doc coverage ≥ 95% | M |
| Supplier portal (M15) | P1 | M | M | procurement | 1.5 | PO confirmation rate ≥ 80% in-portal | L |
| Payment applications (AIA) + AP 3-way match | P0 | H | M | finance, deliveries | 2 | pay-app assembly ≤ 1 h | M |
| Submittals + annotations + drawing compare | P1 | M | M | documents | 1.5 | submittal cycle time measured ↓ | L |
| Lookahead/pull planning + resource conflicts | P1 | H | M | scheduling | 1.5 | weekly lookahead usage ≥ 50% projects | M |
| Estimator AI (ai §7.3) | P0 | VH | H | estimating, price history | 2 | suggestion acceptance ≥ 40%; estimate time ↓ 30% | M |
| Procurement AI: buy timing, PO drafting, supplier scores (ai §7.4) | P0 | H | M | procurement | 1.5 | draft-PO acceptance ≥ 50% | M |
| Scheduling AI: impact simulation, weather adjust (ai §7.5) | P1 | H | H | scheduling | 2 | slip warning lead ≥ 10 days | H |
| Safety AI + Document AI v1 (ai §7.7/7.9) | P1 | M | M | safety, docs, RAG | 1.5 | filing accuracy ≥ 95% | M |
| Sage & Xero connectors | P1 | M | M | accounting framework | 2 | connector parity checklist | M |
| Second locale + metric units (NFR-30 activation) | P2 | M | M | platform | 1.5 | first non-US tenant live | M |

---

## Phase 3 — Intelligence · ~Sprints 29–38 (5 months)

**Objective:** shift customers from reactive to predictive (spec G5); make the Executive Assistant the owner's first screen.

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| Executive Assistant full: NL company Q&A, proactive briefings (ai §7.1) | P0 | VH | H | RAG, projections | 2.5 | exec WAU ≥ 60%; briefing open ≥ 70% | M |
| Financial AI: CTC forecasting, cash-flow projection, anomaly detection (ai §7.10) | P0 | VH | VH | cost-ledger history depth (≥ 2 quarters of actuals) | 3 | forecast MAPE ≤ 10%; anomaly precision ≥ 80% | **H** |
| Predictive schedule risk (float-burn, pattern models) | P0 | H | H | scheduling data | 2 | slip prediction AUC ≥ 0.8 | H |
| Portfolio analytics & custom report builder (M16 full) | P1 | H | M | projections | 2 | self-serve reports ≥ 50% of report volume | L |
| What-if simulation (bid loss, crew moves, delay cascades) | P1 | H | H | financial AI, sched AI | 2 | used in ≥ 30% of exec sessions | M |
| Benchmarking (anonymized, opt-in, cross-tenant aggregates) | P2 | M | H | scale of tenants; legal review | 2 | opt-in ≥ 40%; first benchmark report | H |
| Warranty & closeout module (post-construction, spec §17) | P1 | M | M | punch, documents | 2 | closeout package assembly ≤ 1 day | L |
| Equipment AI: predictive maintenance (ai §7.6) | P2 | M | M | equipment usage history | 1.5 | downtime incidents ↓ 30% | M |
| On-device field AI (offline tagging/transcription, ai §14) | P2 | M | H | mobile maturity | 2 | offline tag latency < 1 s | M |

---

## Version 2 — Platform & Ecosystem · ~Months 20–28

**Objective:** from product to platform (spec G7): open the API, let others build, support complex org structures.

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| Public API GA: versioning, API keys, docs portal, SDKs (TS/Python) | P0 | H | M | api.md maturity | 2.5 | first 25 external integrations | M |
| Webhooks GA + event catalog | P0 | M | L | outbox | 1 | delivery success ≥ 99.5% | L |
| Custom fields & custom workflows (guard-railed) | P0 | H | VH | platform | 3.5 | ≥ 60% tenants define custom fields | **H** |
| Multi-company / holding structures (FR-PLAT-9) | P1 | M | H | tenancy model | 2 | first 10 holding customers | M |
| **Marketplace v1:** app registry, OAuth app model, install flows, review process | P0 | H | VH | public API | 4 | 20 listed apps; marketplace-attributed revenue | H |
| Integration connectors: payroll (ADP/Gusto), takeoff tools, BIM viewers | P1 | H | M/ea | public API | 1–1.5 ea | connector usage per tenant | M |
| Advanced document workflows (transmittals, approval matrices) | P2 | M | M | documents | 1.5 | enterprise doc-control checklist | L |

## Enterprise Track (runs parallel from Phase 2, GA with V2)

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| SSO (SAML/OIDC) + SCIM provisioning | P0 | H | M | auth | 1.5 | enterprise deal unblocked | L |
| SOC 2 Type II certification | P0 | VH | M (program) | security program | audit cycle | report issued | M |
| Approval chains / segregation of duties | P0 | H | M | RBAC | 1.5 | maker/checker on 100% financial approvals | L |
| Data residency + dedicated cluster option (arch §17) | P1 | M | H | infra | 2.5 | first EU-resident tenant | M |
| 99.95% SLA tier: warm-standby DR, status page (arch §20) | P1 | M | H | infra | 2 | DR drill RTO < 1 h quarterly | M |
| Enterprise onboarding tooling: bulk migration, sandbox tenants | P1 | H | M | imports | 1.5 | 1,000-user onboarding ≤ 2 weeks | M |
| Security reviews: annual pentest, questionnaire automation | P1 | M | L | program | ongoing | sales-cycle security stage ≤ 2 weeks | L |

## AI Expansion Track (post-Phase 3, per ai-spec §15 ladder)

| Feature | Priority | Value | Complexity | Dependencies | Sprints | Success Metric | Risk |
|---|---|---|---|---|---|---|---|
| Agent runtime GA: identities, budgets, kill-switch, admin surface | P0 | H | H | tool registry maturity | 2.5 | agent actions 100% attributed/reversible | M |
| Procurement Agent (draft→act ladder) | P0 | VH | H | agent runtime, Proc AI metrics | 2 | POs handled end-to-end ≥ 30% (confirmed) | H |
| Billing Agent (monthly pay-app assembly) | P1 | H | M | pay-apps, agent runtime | 1.5 | pay-app prep time ↓ 80% | M |
| Compliance Agent (cert/insurance chasing) | P1 | M | L | sub compliance | 1 | expired-doc incidents → 0 | L |
| Closeout Agent (O&M/warranty package) | P2 | M | M | warranty module | 1.5 | closeout time ↓ 50% | L |
| Voice-first field capture (hands-free reports) | P2 | M | H | on-device AI | 2 | voice report adoption ≥ 25% field users | M |
| Estimator takeoff from drawings (vision) | P1 | VH | VH | drawing AI corpus | 3+ | takeoff time ↓ 50% at ≥ 90% qty accuracy | **H** |

## Version 3 & Future Vision (Years 3–5+, directional)

- **Autonomy at scale:** the agent ladder matures until routine operations (procurement cycles, billing runs, compliance chasing) run agent-first with human oversight dashboards — spec §17 "Version 3."
- **Industry network:** supplier/sub network effects — shared catalogs, cross-company bid networks, reputation portability (opt-in); financing & insurance integrations built on the platform's ground-truth project data.
- **Benchmark intelligence:** anonymized industry indices (cost, duration, risk) as a data product.
- **BIM/reality capture convergence:** model-linked scheduling and progress (photogrammetry/360° capture partners) once core adoption justifies it.
- **The morning screen:** success is spec §1 literalized — WACO (spec §15.1) as the company's defining metric, with ConstructionOS as the first app opened in the trailer every morning.

---

## Cross-Phase Risk Register (top 5, actively managed)

| Risk | Phase | Mitigation |
|------|-------|------------|
| Offline sync data loss erodes field trust permanently | 1 | Highest-rigor testing (chaos sync suite, device farm); zero-loss exit criterion; conflict UX usability-tested |
| Live margin accuracy vs accounting undermines the core promise | 1 | Pilot reconciliation gate (±1%); accountant persona co-design; QuickBooks sync hardening |
| Scheduling engine complexity swallows the roadmap | 1–2 | CPM scope discipline (no resource-leveling until P2+); buy-vs-build review for Gantt rendering |
| AI cost/quality economics at scale | 2–3 | NFR-27 budgets from day one; router + caching; per-template cost regression gates |
| Custom workflows (V2) become an unmaintainable escape hatch | V2 | Guard-railed primitives only (fields, states, automations); no arbitrary scripting; design-partner council |

## Re-baselining Rules

- Roadmap is re-baselined at each phase gate against: pilot/customer evidence, success-metric actuals, and spec §19 open-question resolutions.
- A feature ships only with its instrumentation (NFR-26); a feature whose success metric fails two consecutive reviews is revised or removed — the roadmap is a portfolio, not a promise list.

---

*End of `roadmap.md` v1.0.*
