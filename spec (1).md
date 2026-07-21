# ConstructionOS — Product Specification (`spec.md`)

> **Document type:** Internal engineering product specification
> **Status:** Draft v1.0 (Foundational)
> **Owner:** Founding Product & Engineering
> **Audience:** Product, Engineering, Design, AI, Security, Leadership
> **Related documents:** `architecture.md`, `database.md`, `api.md`, `ui-design-system.md`, `ai-spec.md`, `roadmap.md`, `codex.md`

---

## 0. How to Read This Document

This is the canonical source of truth for **what** ConstructionOS is and **why** it exists. It defines the product surface, the user model, the module boundaries, and the requirements every downstream document must satisfy. It deliberately avoids implementation detail (stack choices, schemas, endpoints) — those live in the companion documents.

Rules of precedence:

1. If any downstream document (`architecture.md`, `database.md`, etc.) contradicts `spec.md`, **`spec.md` wins** until this document is formally amended.
2. Every functional requirement carries a stable identifier (`FR-<MODULE>-<n>`). Downstream documents must trace to these identifiers.
3. Non-functional requirements (`NFR-<n>`) are contractual. They are not aspirational.

---

## 1. Vision

**ConstructionOS is the operating system a construction company opens first every morning and closes last every night.**

The construction industry runs the physical world — roughly 13% of global GDP — yet operates on fragmented software, spreadsheets, email, phone calls, and paper. The typical mid-market contractor runs eight to fifteen disconnected tools: one for accounting, one for estimating, one for scheduling, a folder system for documents, texts for field coordination, and a whiteboard for everything the software cannot capture. The result is data silos, blind spots, rework, disputes, thin margins, and reactive management.

ConstructionOS replaces that fragmentation with a single, unified, AI-native operating system that runs the *entire* company — from the first lead to the final warranty claim. It is not a tool a company adds to its stack; it is the platform the stack collapses into.

The ten-year vision: **thousands of construction companies and millions of users** — office staff, field crews, executives, clients, subcontractors, and suppliers — operating inside a single coherent system where every module knows about every other module, where AI is woven into every workflow rather than bolted on, and where the software actively drives better decisions instead of merely recording them.

---

## 2. Mission

**Give every construction company the operational intelligence, automation, and clarity previously available only to the largest firms — in software that people actually enjoy using.**

We accomplish this by:

- **Unifying** the entire construction lifecycle into one data model, so information flows without re-entry.
- **Embedding AI** into every module as a native capability — assistants, prediction, automation, and search — not a separate "AI feature."
- **Automating** the repetitive administrative work that consumes the industry's time (data entry, chasing, reconciliation, reporting, scheduling permutations).
- **Surfacing profit and risk** continuously, so management becomes proactive instead of reactive.
- **Designing for the field first**, because the people who build the work are the people the industry's software has historically ignored.

---

## 3. Product Philosophy

1. **One system, one truth.** A datum is entered once and is correct everywhere. A change order updates the estimate, the budget, the schedule, the forecast, and the client portal simultaneously. There is no "sync" because there is nothing to sync.

2. **AI is a layer, not a feature.** Every module is designed *around* the assumption that an AI assistant can read its data, act on its behalf (within permissions), and explain its reasoning. AI is infrastructure.

3. **The field is a first-class citizen.** Field workers are the largest user population and the historically worst-served. Mobile, offline, fast, and simple beats desktop-rich and complex. If it does not work with gloves on, in the sun, with one bar of signal, it does not ship.

4. **Software should reduce work, not add it.** Every feature is measured by net administrative burden. If a feature creates more data-entry than it removes, it is wrong. Automation and defaults are the primary interface.

5. **Elegance is a requirement, not a luxury.** ConstructionOS should feel like Apple, Linear, and Stripe — modern, fast, intuitive, and enjoyable. Construction workers deserve premium software. Delight drives adoption; adoption drives data; data drives intelligence.

6. **Modular but integrated.** Companies buy and adopt modules incrementally, but the modules were designed as one organism. There are no seams a customer can feel.

7. **Decisions over records.** Recording what happened is table stakes. ConstructionOS exists to tell you what to do next: which project is bleeding margin, which material to order today, which crew to move, which client is about to churn.

8. **Trust is earned through transparency.** Every AI recommendation shows its reasoning, its confidence, and its sources. Every automated action is logged and reversible. The system is auditable end to end.

---

## 4. Guiding Principles

| # | Principle | Practical implication |
|---|-----------|-----------------------|
| P1 | Solve a real construction problem | Every feature maps to a documented industry pain point (§8). No feature exists "because competitors have it." |
| P2 | Simplicity over completeness | Ship the 20% of a workflow that covers 80% of usage, beautifully, before the long tail. |
| P3 | Integrate by default | Any new module must define its read/write contract with existing modules before build. |
| P4 | Automate the boring | Prefer a default, a suggestion, or an automation over a blank field. |
| P5 | Offline is not optional | Field-facing features assume intermittent connectivity as the normal case. |
| P6 | Secure and multi-tenant from line one | Tenant isolation, RBAC, and audit are foundational, never retrofitted. |
| P7 | Measure everything | Every feature ships with instrumentation and a success metric. |
| P8 | Explainable AI only | No black-box actions. Confidence and reasoning are always available. |
| P9 | Design for 10 years | Prefer extensible data models and clean boundaries over short-term shortcuts. |
| P10 | Respect the user's expertise | The software augments experienced builders; it does not lecture or oversimplify their craft. |

---

## 5. Product Goals

**G1 — Consolidation.** Replace 8–15 disconnected tools with one platform. Target: a customer can run lead-to-warranty inside ConstructionOS without exporting to another system for core operations.

**G2 — Margin protection.** Give every project a live, accurate profit position and warn before margin erodes. Target: measurable reduction in projects that finish below bid margin.

**G3 — Administrative reduction.** Cut repetitive admin work (data entry, reporting, chasing, reconciliation) by automation and unification. Target: significant reduction in hours per project spent on non-value administrative tasks.

**G4 — Field adoption.** Achieve genuine daily use by field crews, not just office staff. Target: high weekly-active rate among field users, the historically hardest population to convert.

**G5 — Proactive management.** Shift companies from reactive to predictive. Target: the system flags schedule slips, budget overruns, and procurement risks *before* they happen, with lead time to act.

**G6 — Delight.** Achieve best-in-class usability and satisfaction for construction software. Target: category-leading NPS and time-to-first-value.

**G7 — Extensibility.** Build a platform, not a product. Target: new modules, integrations, and (eventually) third-party apps can be added without core rewrites.

---

## 6. Assumptions

- **A1.** Target customers are construction companies from small (5–20 staff) to enterprise (1,000+ staff), across general contracting, specialty trades, home building, and commercial construction. The MVP centers on small-to-mid-market general contractors and specialty subs.
- **A2.** Users have highly variable technical literacy. The field crew and the CFO are the same customer; the UX must serve both.
- **A3.** Connectivity in the field is intermittent and unreliable. Offline-first is mandatory for field workflows.
- **A4.** Customers already have data in other systems (accounting, spreadsheets, legacy tools). Import and migration are day-one requirements, not afterthoughts.
- **A5.** Construction is regional and regulatory. Terminology, compliance, tax, currency, and units vary by jurisdiction. The data model must be localization-ready even if MVP ships one locale.
- **A6.** AI model capability and cost will continue improving. We build a model-agnostic AI layer rather than coupling to a single provider.
- **A7.** Customers will not adopt everything at once. Modular, incremental adoption with a "wedge" module is the go-to-market reality.
- **A8.** Data ownership belongs to the customer. Export must always be possible; we never hold data hostage.

---

## 7. Product Constraints

- **C1 — Regulatory & compliance.** Financial and safety data are subject to regional regulation (tax, lien law, OSHA/local safety authorities, data residency such as GDPR). The platform must be configurable per jurisdiction and support data residency.
- **C2 — Multi-tenancy.** All data is tenant-scoped. Cross-tenant data leakage is a catastrophic failure class and is architecturally prevented, not policy-prevented.
- **C3 — Offline reliability.** Field data captured offline must never be lost and must reconcile deterministically. Conflict resolution rules are defined, not improvised.
- **C4 — Performance envelope.** Core interactions must feel instant (see NFRs). Construction users abandon slow tools; the field will not tolerate spinners.
- **C5 — Integration reality.** We must interoperate with incumbent accounting (QuickBooks, Sage, Xero), file systems, and email/calendar, because rip-and-replace of accounting is often infeasible at first.
- **C6 — Cost of AI.** AI features must be cost-bounded per tenant, with graceful degradation and caching, so unit economics remain viable at millions of users.
- **C7 — Security posture.** SOC 2 Type II readiness, encryption in transit and at rest, and least-privilege access are baseline requirements before enterprise sales.
- **C8 — Backward compatibility.** Once public APIs and mobile clients ship, breaking changes follow a versioning and deprecation policy.

---

## 8. Business Problems (the market we are attacking)

These are the concrete, documented pains ConstructionOS exists to solve. Every module and feature must trace back to at least one.

| ID | Problem | Consequence today | ConstructionOS response |
|----|---------|-------------------|-------------------------|
| BP1 | **Fragmented tooling** — 8–15 disconnected systems | Data silos, double entry, reconciliation overhead, no single view | Unified platform on one data model (§11) |
| BP2 | **Spreadsheet dependence** for estimating, budgets, tracking | Version chaos, formula errors, no audit trail, no collaboration | Structured estimating, budgets, and reporting as native objects |
| BP3 | **Office ↔ field disconnect** | Field lacks current plans/specs; office lacks real-time field status | Real-time sync + offline mobile + field-first UX |
| BP4 | **Low profit visibility** | Companies discover margin loss after the project closes | Live per-project P&L, cost-to-complete, margin alerts |
| BP5 | **Weak forecasting** | Cash, schedule, and resource surprises | Predictive analytics on schedule, cash flow, and resourcing |
| BP6 | **Reactive management** | Fires fought after they start | Proactive alerts and AI-surfaced risks before impact |
| BP7 | **Manual admin burden** | Estimators, PMs, and admins spend hours on data entry and reporting | Automation, defaults, AI drafting, auto-generated reports |
| BP8 | **Poor document management** | Wrong plan versions built, lost RFIs/submittals, dispute exposure | Versioned document control, RFIs/submittals as first-class objects |
| BP9 | **Weak procurement intelligence** | Overpaying, late orders, stockouts, no supplier performance data | Procurement engine with supplier scoring and lead-time intelligence |
| BP10 | **Poor equipment visibility** | Idle or lost equipment, missed maintenance, utilization blind spots | Equipment registry, utilization, maintenance, GPS-ready |
| BP11 | **Bad mobile experience** | Field avoids the software; data never gets captured | Premium offline-first mobile as a primary surface |
| BP12 | **No executive intelligence** | Owners fly blind across the portfolio | Executive dashboards + AI executive assistant |
| BP13 | **No predictive analytics** | Everything is hindsight | Forecasting and prediction across modules |
| BP14 | **Communication breakdown** | Clients, subs, and suppliers left guessing; disputes | Portals + structured collaboration + notifications |
| BP15 | **Rework and disputes** | Margin destroyed by errors, claims, and change disputes | Change orders, daily logs, photo evidence, and audit trails |
| BP16 | **Onboarding friction with legacy data** | Adoption stalls at migration | Import/migration tooling and accounting integrations |

---

## 9. User Personas

Personas define who we build for and what "good" means to them. Each has a **primary surface** (where they live) and a **core job** (what they need the OS to do).

### 9.1 Field Worker / Foreman — "Marco"
- **Context:** On-site, mobile-only, gloves, sun glare, intermittent signal. Low patience for software.
- **Core job:** Log daily progress, hours, and materials; capture photos; view current plans; report issues; receive today's tasks.
- **Success:** Under 2 minutes to file a daily report; works offline; nothing is lost; never has to call the office for a plan.
- **Anti-goals:** Complex forms, desktop-only features, anything requiring more than a few taps.

### 9.2 Project Manager — "Dana"
- **Context:** Split between office and site, desktop + tablet + phone. The operational hub of a project.
- **Core job:** Manage schedule, budget, subs, RFIs, submittals, change orders, and client communication for 3–8 concurrent projects.
- **Success:** One screen shows every project's health; change orders update budget and schedule automatically; AI drafts the RFI and flags the slipping task.
- **Anti-goals:** Re-entering data across systems; discovering budget overruns late.

### 9.3 Estimator — "Priya"
- **Context:** Office, desktop-heavy, deadline-driven bidding.
- **Core job:** Produce accurate, fast, competitive estimates from plans and historical cost data.
- **Success:** Reuses assemblies and historical costs; AI suggests line items and quantities; a won bid converts directly into a project budget with zero re-entry.
- **Anti-goals:** Rebuilding estimates from scratch each time; disconnected from actuals.

### 9.4 Executive / Owner — "Sam"
- **Context:** Portfolio-level, mobile + desktop, time-poor, decision-focused.
- **Core job:** Understand company-wide health — profitability, pipeline, cash, risk — and make capital and staffing decisions.
- **Success:** Opens the app and instantly sees which projects make money, what's at risk, and what to do; asks the AI a plain-English question and gets a sourced answer.
- **Anti-goals:** Waiting on staff to compile reports; stale numbers.

### 9.5 Accountant / Financial Controller — "Wei"
- **Context:** Office, desktop, precision- and compliance-driven.
- **Core job:** Job costing, AP/AR, billing (including progress and AIA-style), payroll inputs, reconciliation with accounting system.
- **Success:** Costs flow automatically from field and procurement; billing is generated from real progress; clean two-way sync with QuickBooks/Sage.
- **Anti-goals:** Manual reconciliation; chasing field data.

### 9.6 Client / Owner's Representative — "Elena"
- **Context:** External, non-construction, wants transparency and confidence.
- **Core job:** See progress, approve change orders and selections, review budget/schedule, communicate.
- **Success:** A clean portal shows real progress with photos; approvals are one click; no jargon.
- **Anti-goals:** Email threads, surprise costs, feeling out of the loop.

### 9.7 Subcontractor — "Trades Co."
- **Context:** External partner, mobile-first, works across multiple GCs.
- **Core job:** Receive scope and schedule, submit bids/invoices, report progress, manage compliance docs (insurance, licenses).
- **Success:** Clear scope and schedule, fast payment, simple document submission.
- **Anti-goals:** Unclear expectations, payment delays, redundant paperwork.

### 9.8 Supplier / Vendor — "SupplyChain Inc."
- **Context:** External, order-driven.
- **Core job:** Receive POs, confirm pricing and lead times, manage deliveries, invoice.
- **Success:** Clean POs, delivery scheduling, predictable payment.
- **Anti-goals:** Phone-and-fax ordering, disputes over quantities/prices.

### 9.9 Administrator / Ops Manager — "Ravi"
- **Context:** Configures and governs the company's use of the platform.
- **Core job:** Manage users, roles, permissions, company settings, templates, integrations, and compliance.
- **Success:** Granular control, easy onboarding/offboarding, full audit visibility.
- **Anti-goals:** Rigid permission models; inability to see who did what.

### 9.10 Safety Manager — "Grace"
- **Context:** Office + site, compliance- and incident-driven.
- **Core job:** Toolbox talks, inspections, incident reporting, certifications, compliance tracking.
- **Success:** Field captures safety data easily; incidents route instantly; compliance gaps are flagged before they become liabilities.
- **Anti-goals:** Paper forms, missed inspections, no incident trail.

---

## 10. User Roles & Access Model

Roles map personas onto the RBAC model (detailed in `architecture.md` and `database.md`). Roles are **tenant-scoped**; a user may hold different roles in different projects.

### 10.1 System role tiers

| Tier | Roles | Scope |
|------|-------|-------|
| **Platform** | Super Admin (Anthropic/ops-side, break-glass only) | Cross-tenant support with strict audit |
| **Company (tenant)** | Owner, Company Admin, Executive, Finance, Ops Manager | Company-wide |
| **Project** | Project Manager, Superintendent, Estimator, Foreman, Field Worker, Safety Manager | Per-project assignment |
| **External** | Client, Subcontractor, Supplier | Scoped to the projects/records shared with them |

### 10.2 Permission model

- **Model:** Role-Based Access Control with **attribute/scope overlays** (project membership, module entitlement, record ownership).
- **Granularity:** Permissions are expressed as `module.resource.action` (e.g., `finance.invoice.approve`, `field.dailyreport.create`).
- **Defaults:** Every role ships with a sensible default permission set; Company Admins can customize within guardrails.
- **External isolation:** External roles (client/sub/supplier) can *only* see explicitly shared records and never see internal financials unless deliberately exposed (e.g., approved change-order pricing).
- **Least privilege:** No role has more than its job requires by default. Elevation is explicit and audited.
- **Segregation of duties:** Financial approvals, change-order approvals, and permission changes support maker/checker workflows for enterprise tenants.

### 10.3 Requirement anchor
> **FR-RBAC-1** The system shall enforce tenant-scoped, role-based permissions at the API layer for every resource action, deny-by-default.
> **FR-RBAC-2** The system shall support per-project role assignment distinct from company-level roles.
> **FR-RBAC-3** The system shall scope all external-user access to explicitly shared records only.
> **FR-RBAC-4** The system shall log every permission change and privileged action to an immutable audit trail.

---

## 11. Competitive Advantages (why we win)

We study incumbents (Procore, Buildertrend, Autodesk Construction Cloud, CoConstruct, Monday/Asana/ClickUp adapted for construction) and improve on them. We do **not** copy them.

1. **True unification on one data model.** Incumbents bolt modules together or acquire them; data doesn't flow cleanly. ConstructionOS is one model end to end, so a change propagates everywhere instantly. *This is the moat.*

2. **AI-native, not AI-added.** Competitors are retrofitting chatbots. We designed every module to be readable, actionable, and explainable by AI from day one — executive assistant, estimator AI, procurement AI, document AI, safety AI (see `ai-spec.md`).

3. **Field-first, offline-first UX.** Most construction software is office software with a weak mobile app. We invert it: the field experience is a first-class, offline-native, premium surface.

4. **Decision intelligence, not record-keeping.** We don't just store data; we tell you what to do — margin at risk, procurement to place, crew to move — proactively.

5. **Premium design.** The category is ugly and slow. Apple/Linear/Stripe-grade UX is a durable adoption and retention advantage, especially for field users.

6. **Modular adoption with unified payoff.** Land with one wedge module, expand across the org, and every added module makes the others smarter — a compounding value loop competitors can't match with stitched-together products.

7. **Transparent, auditable automation.** Every AI action shows reasoning, confidence, and sources, and is reversible — critical for trust in a low-margin, dispute-prone, compliance-heavy industry.

8. **Open by design.** Strong import/export, accounting integrations, and (roadmap) a public API and marketplace prevent lock-in fear and create an ecosystem flywheel.

---

## 12. Core Modules

ConstructionOS is organized into modules that share one data model and one AI layer. Each module below states its **purpose**, **key objects**, **primary users**, **AI within it**, and **cross-module integration** (the contract required by principle P3). Module IDs are used throughout the requirements.

> **Integration invariant:** Every module both *emits* domain events and *consumes* others'. The canonical example flows through the doc: a **won Estimate** creates a **Project** with a **Budget**, which seeds the **Schedule**, drives **Procurement**, receives **Field** cost/progress data, feeds **Finance** for billing and job costing, and is visible in **Executive Intelligence** and the **Client Portal** — with no re-entry at any step.

### M1 — CRM & Pre-Construction (Sales)
- **Purpose:** Manage leads, opportunities, contacts, and the bidding pipeline from first contact to signed contract.
- **Key objects:** Lead, Contact, Company, Opportunity, Pipeline Stage, Activity, Proposal, Contract.
- **Primary users:** Sales, Estimator, Owner.
- **AI:** Lead scoring, follow-up drafting, win-probability estimation, proposal generation.
- **Integrations:** Won opportunity → creates **Project (M4)** and hands off to **Estimating (M2)**; Contact/Company shared with **Client Portal (M13)**.

### M2 — Estimating & Bidding
- **Purpose:** Produce accurate, fast estimates from assemblies, historical costs, and plan takeoffs; manage bid invitations to subs.
- **Key objects:** Estimate, Line Item, Assembly, Cost Item/Cost Book, Takeoff, Bid Package, Bid Invitation, Markup.
- **Primary users:** Estimator, PM.
- **AI:** Estimator AI — line-item suggestion, quantity/takeoff assist, historical-cost lookup, pricing anomaly detection, bid-leveling.
- **Integrations:** Won estimate → **Budget (M9)** with zero re-entry; cost book informed by **Procurement (M5)** actuals; bid packages fan out to **Subcontractors (M14)**.

### M3 — Document & Drawing Management
- **Purpose:** Single source of truth for plans, specs, submittals, RFIs, contracts, permits, and all project documents with version control.
- **Key objects:** Document, Version, Folder, Drawing Set, Sheet, RFI, Submittal, Transmittal, Markup/Annotation.
- **Primary users:** PM, Field, Architect/Engineer (external), Client.
- **AI:** Document AI — extraction, classification, summarization, semantic search, drawing comparison/version diff, spec Q&A.
- **Integrations:** Current drawing set available to **Field (M8)** offline; RFIs/submittals link to **Schedule (M7)** and **Tasks (M6)**; contracts link to **Finance (M9)**.

### M4 — Project Management (Core)
- **Purpose:** The container and command center for a project — setup, teams, phases, health, and the hub every other module attaches to.
- **Key objects:** Project, Phase, Cost Code (WBS), Team/Assignment, Milestone, Project Settings, Health Score.
- **Primary users:** PM, Superintendent, Executive.
- **AI:** Project Assistant — status summarization, risk flagging, next-best-action, meeting-minute drafting.
- **Integrations:** Every module writes to and reads from the Project; project health aggregates schedule, budget, safety, and quality signals.

### M5 — Procurement & Purchasing
- **Purpose:** Turn material and subcontract needs into purchase orders, manage suppliers, pricing, lead times, and deliveries.
- **Key objects:** Purchase Order, RFQ/Quote, Supplier, Material/Catalog Item, Delivery, Commitment, Price List.
- **Primary users:** PM, Procurement, Accountant.
- **AI:** Procurement AI — buy-timing recommendations, supplier scoring, price benchmarking, lead-time risk, auto-draft POs from budget/schedule.
- **Integrations:** Consumes **Budget/Schedule (M9/M7)** to know what's needed and when; commitments hit **Finance (M9)**; deliveries update **Inventory (M10)**; POs sent to **Supplier Portal (M15)**.

### M6 — Task & Punch Management
- **Purpose:** Assignable, trackable units of work — internal tasks, checklists, and punch/snag lists — across office and field.
- **Key objects:** Task, Checklist, Punch Item, Assignment, Comment, Attachment, Status.
- **Primary users:** PM, Field, Sub.
- **AI:** Auto-generation of punch items from photos, prioritization, overdue nudging.
- **Integrations:** Tasks tie to **Schedule (M7)** activities, **RFIs (M3)**, and **Daily Reports (M8)**; punch closeout feeds **Warranty (roadmap)**.

### M7 — Scheduling & Planning
- **Purpose:** Build and manage project schedules (Gantt, critical path, lookahead) and resource/crew planning.
- **Key objects:** Schedule, Activity, Dependency, Baseline, Lookahead (pull-plan), Resource Assignment, Constraint.
- **Primary users:** PM, Superintendent, Field.
- **AI:** Scheduling AI — auto-sequencing, delay-impact simulation, weather-aware adjustment, critical-path risk, lookahead generation.
- **Integrations:** Seeded by **Estimate/Budget**; drives **Procurement** timing and **Field** task assignment; change orders re-flow the schedule.

### M8 — Field Operations & Mobile
- **Purpose:** The daily field surface — daily reports, time tracking, photos, progress, weather, issues — offline-first.
- **Key objects:** Daily Report/Log, Time Entry, Photo, Progress Update, Weather Log, Field Issue, Location/Geo-stamp.
- **Primary users:** Foreman, Field Worker, Superintendent.
- **AI:** Photo AI (auto-tagging, progress/defect detection), voice-to-report, auto-summary of the day.
- **Integrations:** Time → **Finance/payroll**; progress → **Schedule** & **Client Portal**; costs → **Budget**; issues → **Tasks/RFIs**. Fully offline with deterministic sync.

### M9 — Financial Intelligence (Job Costing, Budget, Billing)
- **Purpose:** Live project financials — budgets, commitments, actuals, change orders, billing, and job-cost P&L — plus company-level finance.
- **Key objects:** Budget, Cost Code line, Commitment, Actual Cost, Change Order, Invoice (AP/AR), Payment Application (progress/AIA), Forecast (cost-to-complete).
- **Primary users:** Accountant, PM, Executive.
- **AI:** Financial AI — margin-erosion alerts, cost-to-complete forecasting, cash-flow projection, anomaly detection, change-order impact analysis.
- **Integrations:** Fed by **Estimating, Procurement, Field, Time**; two-way sync with external accounting; surfaces to **Executive Intelligence** and (scoped) **Client Portal**.

### M10 — Inventory & Materials
- **Purpose:** Track materials and consumables across warehouses and job sites — stock levels, transfers, and usage.
- **Key objects:** Inventory Item, Location/Warehouse, Stock Level, Transfer, Consumption, Reorder Rule.
- **Primary users:** Procurement, Field, Warehouse.
- **AI:** Reorder prediction, stockout risk, usage anomaly detection.
- **Integrations:** Deliveries in from **Procurement**; consumption from **Field**; costs to **Finance**.

### M11 — Equipment & Asset Management
- **Purpose:** Manage owned/rented equipment — assignment, utilization, maintenance, and cost allocation.
- **Key objects:** Equipment/Asset, Assignment, Utilization Log, Maintenance Schedule, Inspection, Cost Rate, Telematics/GPS (roadmap).
- **Primary users:** Ops, Field, Finance.
- **AI:** Equipment AI — predictive maintenance, utilization optimization, idle-asset detection, rent-vs-buy analysis.
- **Integrations:** Equipment cost rates hit **Job Costing (M9)**; assignments align with **Schedule (M7)**; usage from **Field (M8)**.

### M12 — Safety & Compliance
- **Purpose:** Digitize safety — toolbox talks, inspections, incidents, certifications, and compliance tracking.
- **Key objects:** Safety Form, Toolbox Talk, Inspection, Incident/Near-Miss, Certification, Compliance Item, Corrective Action.
- **Primary users:** Safety Manager, Foreman, Field.
- **AI:** Safety AI — incident triage/classification, hazard detection from photos, compliance-gap alerts, trend analysis.
- **Integrations:** Field-captured; incidents route to **Tasks** and management; certifications gate **Subcontractor (M14)** eligibility.

### M13 — Client Portal
- **Purpose:** A clean, jargon-free external window for clients — progress, photos, selections, approvals, budget (scoped), and communication.
- **Key objects:** Shared Project View, Selection, Approval, Message, Shared Document, Progress Feed.
- **Primary users:** Client, Owner's Rep.
- **AI:** Plain-language status summaries, selection assistance, Q&A over shared docs.
- **Integrations:** Read-scoped views of **Project, Schedule, Finance (approved items), Documents, Field progress**; approvals write back to **Change Orders/Selections**.

### M14 — Subcontractor Management
- **Purpose:** Manage subs across the lifecycle — prequalification, bidding, contracts, scope, compliance, progress, and payment.
- **Key objects:** Subcontractor, Prequalification, Bid, Subcontract, Scope, Compliance Doc (insurance/license), Sub Invoice, Progress Claim.
- **Primary users:** PM, Accountant, Sub (external).
- **AI:** Bid leveling, compliance-expiry alerts, performance scoring.
- **Integrations:** Bids from **Estimating (M2)**; contracts/commitments to **Finance (M9)**; portal access via external roles.

### M15 — Supplier / Vendor Portal
- **Purpose:** External surface for suppliers — POs, order confirmation, delivery scheduling, and invoicing.
- **Key objects:** Shared PO, Order Confirmation, Delivery Schedule, Supplier Invoice, Catalog Sync.
- **Primary users:** Supplier (external), Procurement.
- **AI:** Price/lead-time normalization, delivery-risk flags.
- **Integrations:** Mirrors **Procurement (M5)**; confirmations/deliveries update **Inventory (M10)** and **Finance (M9)**.

### M16 — Executive Intelligence & Reporting
- **Purpose:** Company-wide operational intelligence — dashboards, portfolio health, profitability, pipeline, cash, and custom reports.
- **Key objects:** Dashboard, Widget/Metric, Report, Portfolio View, KPI, Alert.
- **Primary users:** Executive, Owner, Finance, Ops.
- **AI:** Executive Assistant — natural-language querying of the whole company, proactive briefings, anomaly and risk surfacing, "what-if" analysis.
- **Integrations:** Aggregates every module; read-only analytical layer with drill-through.

### M17 — AI Assistant Layer (cross-cutting)
- **Purpose:** The embedded intelligence present in every module — conversational assistant, natural-language search, automations, and agents. Fully specified in `ai-spec.md`; referenced here because it is a product surface, not a hidden service.
- **Key objects:** Conversation, Context/Memory, Tool/Function registry, Automation, Confidence/Reasoning record.
- **Primary users:** All.
- **Integrations:** Reads (permission-scoped) and acts across all modules via a governed tool-calling interface.

### M18 — Platform & Administration (cross-cutting)
- **Purpose:** The connective tissue — auth, users, roles/permissions, company/tenant settings, templates, integrations, audit, notifications, and billing.
- **Key objects:** User, Role, Permission, Company/Tenant, Template, Integration/Connector, Audit Log, Notification, Subscription.
- **Primary users:** Admin, Owner, Ops.
- **Integrations:** Underpins every module; provides identity, entitlement, notification, and audit services platform-wide.

---

## 13. Functional Requirements

Functional requirements are grouped by module and carry stable IDs (`FR-<MODULE>-<n>`). This is the MVP-and-beyond superset; the MVP subset is scoped in §16. Requirements use RFC-2119 language (**shall**, **should**, **may**).

### 13.0 Platform & Administration (M18)
- **FR-PLAT-1** The system **shall** support multi-tenant companies with complete data isolation between tenants.
- **FR-PLAT-2** The system **shall** provide secure authentication (email/password, SSO/SAML/OAuth for enterprise, MFA).
- **FR-PLAT-3** The system **shall** provide RBAC per §10, deny-by-default, enforced server-side.
- **FR-PLAT-4** The system **shall** maintain an immutable audit log of privileged and financial actions.
- **FR-PLAT-5** The system **shall** provide a unified notification service (in-app, email, push, and SMS-ready) with per-user preferences and digesting.
- **FR-PLAT-6** The system **shall** support company-level templates (projects, estimates, checklists, reports) for reuse.
- **FR-PLAT-7** The system **shall** provide data import (CSV/Excel and guided migration) and full data export.
- **FR-PLAT-8** The system **shall** support integrations with accounting systems (QuickBooks, Sage, Xero) and calendar/email.
- **FR-PLAT-9** The system **should** support multi-company/holding structures where one owner operates several tenants.
- **FR-PLAT-10** The system **shall** provide user onboarding/offboarding with immediate access revocation.

### 13.1 CRM & Pre-Construction (M1)
- **FR-CRM-1** The system **shall** capture and manage leads, contacts, companies, and opportunities through configurable pipeline stages.
- **FR-CRM-2** The system **shall** log activities (calls, emails, meetings, notes) against contacts and opportunities.
- **FR-CRM-3** The system **shall** generate proposals/contracts from templates and track their status.
- **FR-CRM-4** The system **shall** convert a won opportunity into a Project (M4) without data re-entry.
- **FR-CRM-5** The system **should** provide AI lead scoring and win-probability estimates with reasoning.
- **FR-CRM-6** The system **should** draft follow-up communications for user review.

### 13.2 Estimating & Bidding (M2)
- **FR-EST-1** The system **shall** allow creation of estimates from line items, assemblies, and a reusable cost book.
- **FR-EST-2** The system **shall** support quantity takeoff (manual MVP; plan-based/AI-assisted roadmap).
- **FR-EST-3** The system **shall** apply configurable markups, margins, taxes, and contingencies.
- **FR-EST-4** The system **shall** version estimates and preserve history.
- **FR-EST-5** The system **shall** convert a won estimate directly into a project **Budget (M9)** with mapped cost codes.
- **FR-EST-6** The system **shall** manage bid packages and invitations to subcontractors (M14) and level received bids.
- **FR-EST-7** The system **should** provide Estimator AI: line-item suggestions, historical-cost lookup, and pricing-anomaly flags with confidence.

### 13.3 Document & Drawing Management (M3)
- **FR-DOC-1** The system **shall** store documents in a tenant/project folder hierarchy with role-based access.
- **FR-DOC-2** The system **shall** version every document and identify the current version unambiguously.
- **FR-DOC-3** The system **shall** manage drawing sets and sheets with markup/annotation.
- **FR-DOC-4** The system **shall** manage RFIs and Submittals as first-class objects with status, assignees, and due dates.
- **FR-DOC-5** The system **shall** make the current drawing set available to the field (M8) including offline.
- **FR-DOC-6** The system **should** provide Document AI: extraction, classification, semantic search, summarization, and drawing version-diff.
- **FR-DOC-7** The system **shall** maintain an access and change history for every document.

### 13.4 Project Management (M4)
- **FR-PM-1** The system **shall** allow creation of projects with phases, cost codes (WBS), teams, and milestones.
- **FR-PM-2** The system **shall** compute a live project health score aggregating schedule, budget, safety, and quality signals.
- **FR-PM-3** The system **shall** present a project command center summarizing all modules for that project.
- **FR-PM-4** The system **shall** support project templates for rapid, consistent setup.
- **FR-PM-5** The system **should** provide a Project Assistant that summarizes status, flags risk, and suggests next actions.

### 13.5 Procurement & Purchasing (M5)
- **FR-PROC-1** The system **shall** create RFQs and Purchase Orders and track them through delivery.
- **FR-PROC-2** The system **shall** maintain a supplier registry with pricing, lead times, and performance history.
- **FR-PROC-3** The system **shall** link POs to budget cost codes, creating commitments in **Finance (M9)**.
- **FR-PROC-4** The system **shall** track deliveries and update **Inventory (M10)** on receipt.
- **FR-PROC-5** The system **should** provide Procurement AI: buy-timing recommendations, supplier scoring, and price benchmarking with reasoning.
- **FR-PROC-6** The system **should** auto-draft POs from budget and schedule needs for user approval.

### 13.6 Task & Punch Management (M6)
- **FR-TASK-1** The system **shall** create, assign, and track tasks and checklists with status, due dates, and attachments.
- **FR-TASK-2** The system **shall** manage punch/snag lists tied to locations and drawings.
- **FR-TASK-3** The system **shall** link tasks to schedule activities, RFIs, and daily reports.
- **FR-TASK-4** The system **should** auto-generate punch items from field photos (Photo AI).

### 13.7 Scheduling & Planning (M7)
- **FR-SCH-1** The system **shall** build project schedules with activities, dependencies, and critical path.
- **FR-SCH-2** The system **shall** support baselines and track variance against them.
- **FR-SCH-3** The system **shall** support short-interval/lookahead (pull) planning.
- **FR-SCH-4** The system **shall** re-flow the schedule when change orders or delays are recorded, with impact analysis.
- **FR-SCH-5** The system **shall** assign resources/crews to activities and surface conflicts.
- **FR-SCH-6** The system **should** provide Scheduling AI: auto-sequencing, weather-aware adjustment, and delay-impact simulation.

### 13.8 Field Operations & Mobile (M8)
- **FR-FIELD-1** The system **shall** provide daily reports capturing labor, materials, equipment, weather, progress, and notes.
- **FR-FIELD-2** The system **shall** capture time entries per worker/crew and route them to job costing/payroll.
- **FR-FIELD-3** The system **shall** capture geo-/time-stamped photos and attach them to projects, tasks, and reports.
- **FR-FIELD-4** The system **shall** function fully offline for field workflows and reconcile deterministically on reconnect (§14 NFRs).
- **FR-FIELD-5** The system **shall** deliver today's assigned tasks and current plans to field users.
- **FR-FIELD-6** The system **should** provide voice-to-report and AI daily-summary generation.
- **FR-FIELD-7** The system **should** provide Photo AI: auto-tagging and progress/defect detection.

### 13.9 Financial Intelligence (M9)
- **FR-FIN-1** The system **shall** maintain a project budget by cost code with original, revised, committed, actual, and forecast columns.
- **FR-FIN-2** The system **shall** manage change orders and propagate their impact to budget, schedule, and client-facing views.
- **FR-FIN-3** The system **shall** compute live cost-to-complete and projected margin per project.
- **FR-FIN-4** The system **shall** generate progress billing / payment applications (including AIA-style).
- **FR-FIN-5** The system **shall** track AP (subs/suppliers) and AR (clients) and reconcile with the external accounting system.
- **FR-FIN-6** The system **shall** alert when margin erodes past configurable thresholds.
- **FR-FIN-7** The system **should** provide Financial AI: cash-flow projection, anomaly detection, and change-order impact forecasting with confidence.

### 13.10 Inventory & Materials (M10)
- **FR-INV-1** The system **shall** track inventory items and stock levels across warehouses and job sites.
- **FR-INV-2** The system **shall** record transfers and consumption and value them into job costs.
- **FR-INV-3** The system **should** predict reorder needs and flag stockout risk.

### 13.11 Equipment & Asset Management (M11)
- **FR-EQ-1** The system **shall** maintain an equipment registry with assignment, cost rates, and status.
- **FR-EQ-2** The system **shall** track utilization and allocate equipment cost to job costing.
- **FR-EQ-3** The system **shall** manage maintenance schedules and inspections with reminders.
- **FR-EQ-4** The system **should** provide Equipment AI: predictive maintenance and idle-asset detection.

### 13.12 Safety & Compliance (M12)
- **FR-SAFE-1** The system **shall** capture toolbox talks, inspections, and incidents/near-misses from the field.
- **FR-SAFE-2** The system **shall** track certifications and compliance items with expiry alerts.
- **FR-SAFE-3** The system **shall** route incidents to corrective actions and management notification.
- **FR-SAFE-4** The system **should** provide Safety AI: incident classification, hazard detection from photos, and trend analysis.

### 13.13 Client Portal (M13)
- **FR-CLIENT-1** The system **shall** provide clients a scoped, read-mostly view of progress, photos, schedule, and shared documents.
- **FR-CLIENT-2** The system **shall** support client approvals of change orders and selections with an audit trail.
- **FR-CLIENT-3** The system **shall** provide structured client messaging.
- **FR-CLIENT-4** The system **shall** never expose internal financials or other tenants' data to clients.
- **FR-CLIENT-5** The system **should** provide plain-language AI status summaries for clients.

### 13.14 Subcontractor Management (M14)
- **FR-SUB-1** The system **shall** manage sub prequalification, bids, subcontracts, and scopes.
- **FR-SUB-2** The system **shall** track sub compliance documents (insurance, licenses) with expiry alerts and eligibility gating.
- **FR-SUB-3** The system **shall** process sub invoices/progress claims into commitments and AP.
- **FR-SUB-4** The system **should** score subcontractor performance.

### 13.15 Supplier / Vendor Portal (M15)
- **FR-VEND-1** The system **shall** share POs with suppliers and capture order confirmations and delivery schedules.
- **FR-VEND-2** The system **shall** accept supplier invoices and match them to POs/receipts (2-/3-way match).
- **FR-VEND-3** The system **should** normalize supplier pricing and flag delivery risk.

### 13.16 Executive Intelligence & Reporting (M16)
- **FR-EXEC-1** The system **shall** provide configurable dashboards with portfolio-level KPIs (profitability, pipeline, cash, risk).
- **FR-EXEC-2** The system **shall** provide reporting with drill-through to source records.
- **FR-EXEC-3** The system **shall** provide proactive alerts on company-wide risks and anomalies.
- **FR-EXEC-4** The system **should** provide an Executive Assistant answering natural-language questions across the company with sources.

### 13.17 AI Assistant Layer (M17)
- **FR-AI-1** The system **shall** provide an embedded conversational assistant accessible in every module, scoped to the user's permissions.
- **FR-AI-2** The system **shall** provide natural-language search across all permitted data (RAG-based).
- **FR-AI-3** The system **shall** allow the assistant to take actions via a governed tool-calling interface, respecting RBAC and requiring confirmation for consequential actions.
- **FR-AI-4** The system **shall** attach confidence scores and reasoning/sources to AI outputs.
- **FR-AI-5** The system **shall** escalate to a human (or refuse) when confidence is below a defined threshold.
- **FR-AI-6** The system **shall** log all AI actions to the audit trail and make them reversible where they mutate data.
- *(Full AI specification: `ai-spec.md`.)*

---

## 14. Non-Functional Requirements

Non-functional requirements are contractual (`NFR-<n>`). They apply platform-wide unless scoped.

### 14.1 Performance
- **NFR-1** P95 API response time for core read operations **shall** be ≤ 300 ms; P99 ≤ 800 ms (excluding heavy analytics/AI).
- **NFR-2** Interactive UI actions **shall** feel instant: first meaningful paint ≤ 1.5 s on broadband; navigation transitions ≤ 100 ms perceived (optimistic UI).
- **NFR-3** Mobile field actions (open report, capture photo, save) **shall** complete locally in ≤ 200 ms regardless of connectivity.
- **NFR-4** Analytics/dashboard queries **should** return in ≤ 3 s at P95 via pre-aggregation/caching.

### 14.2 Scalability
- **NFR-5** The platform **shall** be designed to scale to thousands of tenants and millions of users without architectural rewrite (horizontal scaling; see `architecture.md`).
- **NFR-6** No single tenant's load **shall** degrade another tenant's experience (noisy-neighbor isolation).
- **NFR-7** The data model **shall** support projects with tens of thousands of documents, line items, and daily records without pathological degradation.

### 14.3 Availability & Reliability
- **NFR-8** Core platform availability target **shall** be 99.9% monthly (enterprise tier 99.95%).
- **NFR-9** No committed data **shall** be lost on failure; RPO ≤ 5 minutes, RTO ≤ 1 hour for core services.
- **NFR-10** Field data captured offline **shall** never be lost and **shall** reconcile deterministically per defined conflict-resolution rules.

### 14.4 Offline & Sync
- **NFR-11** Field-facing features **shall** operate fully offline for a defined working set (assigned projects, current plans, today's tasks).
- **NFR-12** Sync **shall** be conflict-aware with last-writer and field-level merge rules defined per object; unresolved conflicts surface for human resolution, never silent loss.

### 14.5 Security & Privacy
- **NFR-13** All data **shall** be encrypted in transit (TLS 1.2+) and at rest (AES-256 or equivalent).
- **NFR-14** Tenant isolation **shall** be enforced architecturally at the data layer; cross-tenant access is impossible by construction, not by policy.
- **NFR-15** The platform **shall** target SOC 2 Type II and support GDPR obligations (data residency, right to erasure, DPA).
- **NFR-16** All access **shall** follow least privilege; secrets are managed in a vault; MFA is available and enforceable per tenant.
- **NFR-17** Every privileged, financial, and AI action **shall** be recorded in an immutable audit log.

### 14.6 Usability & Accessibility
- **NFR-18** The product **shall** meet WCAG 2.1 AA.
- **NFR-19** The product **shall** be fully responsive across desktop, tablet, and mobile per `ui-design-system.md`.
- **NFR-20** Field UX **shall** be usable one-handed, with large touch targets and high-contrast/outdoor-legible modes.
- **NFR-21** Time-to-first-value for a new company (first project set up) **should** be under one working day with import/templates.

### 14.7 Maintainability & Extensibility
- **NFR-22** The codebase **shall** follow clean architecture and SOLID; modules are independently deployable-ready with clear contracts (see `architecture.md`).
- **NFR-23** Public APIs **shall** be versioned with a documented deprecation policy.
- **NFR-24** All modules **shall** emit and consume domain events over a shared event bus to preserve integration invariants.

### 14.8 Observability
- **NFR-25** The platform **shall** provide centralized structured logging, metrics, tracing, and alerting.
- **NFR-26** Every feature **shall** ship with product instrumentation tied to a success metric (§15).

### 14.9 Cost & AI Governance
- **NFR-27** AI usage **shall** be metered and cost-bounded per tenant, with caching and graceful degradation to protect unit economics.
- **NFR-28** The AI layer **shall** be model-agnostic (swap providers without rewriting product features).
- **NFR-29** AI **shall** never expose one tenant's data to another or to model providers in violation of tenant data agreements.

### 14.10 Localization
- **NFR-30** The data model and UI **shall** be localization-ready (currency, units, tax, language, date formats) even where MVP ships a single locale.

---

## 15. Success Metrics

Metrics are grouped by the outcome they prove. Each ships with instrumentation (NFR-26). Targets are directional for v1 and refined per cohort.

### 15.1 North-Star Metric
**Weekly Active Company Operations (WACO):** the number of companies for whom ConstructionOS is the daily system of record — measured as tenants with active use across ≥3 modules and ≥60% of licensed users active weekly. This single number captures consolidation (G1), adoption (G4), and stickiness at once.

### 15.2 Adoption & Engagement
- Company activation rate (set up first project within 7 days).
- Field weekly-active rate (field users active ≥3 days/week) — the hardest and most telling number.
- Modules-in-use per tenant (consolidation proxy; target growth over time).
- DAU/WAU and stickiness ratio per persona.
- Time-to-first-value (company signup → first meaningful output, e.g., first estimate or daily report).

### 15.3 Business Value Delivered (customer outcomes)
- Reduction in admin hours per project (survey + telemetry proxy).
- % of projects finishing at or above bid margin (margin protection, G2).
- Lead time on risk alerts (how far ahead we flag slips/overruns) — proactive management (G5).
- Change-order cycle time (creation → client approval → budget update).
- Reduction in tools replaced per customer (consolidation, G1).

### 15.4 AI Effectiveness
- AI suggestion acceptance rate (per assistant/module).
- AI action reversal rate (lower is better; trust signal).
- Search success rate (query → user acts on a result).
- % of qualifying tasks automated end-to-end.
- AI cost per active tenant (unit-economics guardrail, NFR-27).

### 15.5 Reliability & Quality
- Uptime vs. SLA (NFR-8).
- Sync failure / data-loss incidents (target: zero data loss, NFR-10).
- P95/P99 latency vs. NFRs.
- Critical bug escape rate and MTTR.

### 15.6 Commercial
- Net revenue retention (expansion via modules and seats).
- Gross logo and revenue churn.
- Expansion rate (modules added per tenant over time).
- NPS / CSAT by persona (target category-leading, G6).
- CAC payback and LTV/CAC.

---

## 16. MVP Scope

The MVP proves the core thesis — **unification + field-first + embedded AI** — for a focused segment (small-to-mid-market general contractors and specialty subs), with one wedge that pulls the rest of the org in.

### 16.1 MVP strategy
- **Wedge:** Project Management + Field Operations + Financial visibility. This is where fragmentation hurts most daily and where field-first + live margin is an immediate, felt win.
- **Prove the invariant:** Demonstrate zero-re-entry flow across at least Estimate → Budget → Field costs → Live margin → Client visibility.
- **Prove AI-native:** Ship at least the Project Assistant, natural-language search, and Photo AI so AI is visibly woven in, not promised.
- **Prove field adoption:** Offline-first mobile that field crews actually use daily.

### 16.2 In scope for MVP

| Module | MVP inclusion |
|--------|---------------|
| M18 Platform/Admin | Auth (email + MFA), tenants, RBAC, users/roles, notifications, audit, import/export, **QuickBooks integration** |
| M4 Project Management | Projects, phases, cost codes, teams, milestones, command center, health score (v1), templates |
| M8 Field Operations | Daily reports, time tracking, photos, progress, **offline-first mobile**, today's tasks/plans |
| M9 Financial Intelligence | Budget by cost code, commitments, actuals, change orders, live cost-to-complete & margin, margin alerts, basic progress billing |
| M2 Estimating | Line-item/assembly estimates, cost book, markups, **won-estimate → budget** conversion |
| M3 Documents | Folders, versioned documents, current-set access offline, RFIs (v1) |
| M6 Tasks/Punch | Tasks, checklists, punch lists, links to schedule/reports |
| M7 Scheduling | Gantt, dependencies, critical path, baselines (v1); lookahead basic |
| M13 Client Portal | Scoped progress/photo view + change-order/selection approvals |
| M16 Executive Intelligence | Core dashboards (profitability, pipeline-lite, project health) |
| M17 AI Layer | Project Assistant, NL search (RAG), Photo AI, with confidence/reasoning + audit |

### 16.3 Explicitly out of MVP (fast-follow / later)
- Full Procurement engine (M5), Inventory (M10), Equipment (M11) — beyond basic stubs.
- Supplier Portal (M15) and deep Subcontractor management (M14) — sub compliance/bid basics may be v1.1.
- Safety module (M12) full suite — incident capture may be v1.1.
- Advanced AI (Estimator/Procurement/Scheduling/Financial/Safety AI full features), predictive analytics suite.
- Public API + marketplace, multi-company holding structures, non-QuickBooks accounting connectors, additional locales.
- Voice-to-report, drawing AI version-diff, telematics/GPS.

### 16.4 MVP exit criteria
- A pilot GC can run a real project end-to-end (estimate → build → bill → client visibility) inside ConstructionOS without leaving for another core tool.
- Field crews on the pilot are weekly-active offline.
- Zero data-loss incidents across the pilot.
- Live margin on a project is demonstrably accurate versus the customer's own accounting.
- At least three embedded AI capabilities are used weekly with positive acceptance.

---

## 17. Future Roadmap (product-level)

This is the product-level shape; full sequencing, priority, complexity, dependencies, sprint estimates, and risk live in `roadmap.md`.

**Phase 1 — MVP (Foundation & Wedge).** §16. Unification core, field-first mobile, live financials, first embedded AI. Prove the thesis with pilots.

**Phase 2 — Operational Depth.** Full Procurement, Inventory, Equipment, Safety, and Subcontractor/Supplier portals. Expand AI to Estimator, Procurement, and Scheduling assistants. Additional accounting connectors.

**Phase 3 — Intelligence.** Predictive analytics across schedule, cash flow, and resourcing. Executive Assistant maturity, proactive briefings, and "what-if" simulation. Company-wide operational intelligence.

**Version 2 — Platform & Ecosystem.** Public versioned API, webhooks, and a third-party app/integration marketplace. Multi-company/holding support. Advanced customization (custom fields, workflows) within guardrails.

**Version 3 — Autonomy.** AI agents that execute multi-step operations (e.g., manage a procurement cycle, assemble a schedule, prepare a billing run) under human oversight with confidence gates. Deeper offline AI.

**Enterprise.** SSO/SAML at scale, advanced governance (segregation of duties, approval chains), data residency options, dedicated environments, 99.95% SLA, procurement/security questionnaires, and enterprise onboarding.

**Post-construction & lifecycle expansion.** Warranty management, closeout, O&M handover, and long-term asset/facility linkage — extending the OS past project completion.

**Future Vision.** ConstructionOS as the connective platform for the industry: benchmarking (anonymized), a supplier/sub network, financing and insurance integrations, and an ecosystem where the OS is the default operating layer construction runs on.

---

## 18. Technical Goals

These are the engineering north stars every downstream document must uphold. They are product requirements expressed at the platform level; detailed realization lives in `architecture.md`, `database.md`, `api.md`, `ui-design-system.md`, and `ai-spec.md`.

1. **One unified data model.** A single, well-normalized, event-emitting model underpins every module so data is entered once and correct everywhere (BP1, philosophy §3.1). No module owns a private silo of shared truth.

2. **Modular, cleanly-bounded architecture.** Modules communicate through explicit contracts and a shared event bus (NFR-24), so they can evolve, scale, and eventually deploy independently — a modular monolith that can decompose toward services where load demands (rationale in `architecture.md`).

3. **AI as first-class infrastructure.** A governed, model-agnostic AI layer (RAG, memory, tool-calling, confidence, audit) is available to every module (NFR-28, §12 M17). Product features assume AI can read and act, within RBAC.

4. **Offline-first field platform.** A robust local-first data layer with deterministic sync and defined conflict resolution (NFR-10/11/12) — treated as core infrastructure, not a mobile add-on.

5. **Multi-tenant, secure by construction.** Architectural tenant isolation, encryption everywhere, least privilege, and end-to-end audit (NFR-13–17). Security is designed in from line one (P6).

6. **Scale-ready from day one.** Horizontally scalable, statelessness where possible, caching and pre-aggregation for analytics, and noisy-neighbor isolation (NFR-5/6) — architected for millions of users even while serving the first hundred.

7. **Performance as a feature.** Optimistic UI, edge/CDN delivery, and tight latency budgets (NFR-1–4). The field will not tolerate slowness; speed is a product requirement.

8. **Observable and instrumented.** Structured logging, metrics, tracing, and per-feature product analytics (NFR-25/26) so we operate reliably and learn continuously.

9. **Open and interoperable.** First-class import/export, accounting integrations now, and a versioned public API + webhooks later (NFR-23) — no lock-in, ecosystem-ready.

10. **Maintainable for a decade.** Clean architecture, SOLID, strong typing (TypeScript end-to-end target), automated testing, and documented decisions (NFR-22, P9) so the platform keeps expanding for 10+ years.

---

## 19. Open Questions & Decisions to Track

- **OQ1** MVP accounting connector priority — confirm QuickBooks-first; Sage/Xero sequencing.
- **OQ2** Initial launch locale(s) and units (imperial vs metric default) and first regulatory jurisdiction.
- **OQ3** Pricing/packaging by module vs. seat vs. hybrid — affects entitlement model in M18.
- **OQ4** Depth of native scheduling vs. interop with existing schedulers (e.g., P6/MS Project) in early phases.
- **OQ5** AI provider strategy and data-processing agreements per tenant (NFR-28/29).
- **OQ6** Conflict-resolution policy specifics per offline object (owner: architecture + field-ops leads).
- **OQ7** Extent of native payroll vs. integration for time → pay.

*Track resolutions here and amend the relevant section; this document is the source of truth (§0).*

---

## 20. Glossary (selected)

- **Cost Code / WBS:** The work-breakdown structure that organizes budget, costs, and commitments.
- **Commitment:** A contractual obligation to spend (PO or subcontract) recorded before actual cost lands.
- **Cost-to-Complete (CTC):** Forecast of remaining cost to finish a scope; drives projected margin.
- **Change Order (CO):** A change to contract scope/price/time; must propagate to budget, schedule, and client view.
- **Daily Report / Log:** The field record of a day's labor, materials, equipment, weather, and progress.
- **RFI:** Request for Information — a formal question to the design team, tracked to resolution.
- **Submittal:** A document/product sample submitted for approval before installation.
- **Punch / Snag List:** Remaining defects/items to complete before closeout.
- **Lookahead / Pull Plan:** Short-interval (e.g., 3–6 week) collaborative planning.
- **Payment Application (AIA-style):** Progress-based billing document (e.g., G702/G703 format).
- **Tenant:** A single construction company's isolated data domain within the multi-tenant platform.

---

*End of `spec.md` v1.0.*



