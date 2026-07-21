# ConstructionOS — AI Specification (`ai-spec.md`)

> **Document type:** AI platform & product specification
> **Status:** Draft v1.0
> **Traces to:** `spec.md` (M17, FR-AI-1–6, NFR-27–29, P8 explainable AI), `architecture.md` (§7), `database.md` (§19)
> **Audience:** AI engineering, backend, security, product

---

## 1. AI Vision

AI in ConstructionOS is **infrastructure, not a feature** (spec §3.2). Every module assumes an intelligence layer that can read its data (within permissions), draft its artifacts, predict its risks, and — under human oversight — act. The measure of success is not "we have a chatbot"; it is spec §15.4: suggestions accepted, hours of admin work eliminated, risks flagged before they cost money, and near-zero reversals of AI actions.

Three design laws govern everything below:

1. **Same rails as humans.** AI reads through the retrieval layer and writes through the exact application use-cases humans use — same RBAC, same validation, same audit. There is no AI side door.
2. **Explainable or absent.** Every output carries sources, reasoning access, and a confidence score (FR-AI-4). If we can't attribute it, we don't ship it.
3. **Autonomy is earned per action class.** Read → draft → suggest → act-with-confirmation → act-autonomously is a promotion ladder gated by measured accuracy, never a launch setting.

## 2. AI Platform Architecture

```
Product surfaces (web/mobile modules, portals)
        │  SSE / REST (§api.md 13)
┌───────▼────────────────────────────────────────────┐
│ AI GATEWAY (satellite service, TypeScript)         │
│  • provider router (Anthropic-first, adapters)     │
│  • prompt template registry (versioned)            │
│  • per-tenant budgets, metering, caching           │
│  • guardrails: PII, injection, tenancy             │
│  • ai_runs audit writer                            │
├────────────┬───────────────┬───────────────────────┤
│ RAG service │ Tool runtime  │ Batch/agent workers  │
│ (retrieval, │ (function     │ (embeddings, photo   │
│  reranking) │  registry,    │  pipeline, forecasts,│
│             │  confirm gate)│  briefings, agents)  │
└──────┬─────┴──────┬────────┴──────────┬───────────┘
       │            │                   │
   pgvector     Core API use-cases   NATS events / queues
   (RLS'd)      (RBAC enforced)      (triggers, outbox)
```

- **Model strategy (NFR-28):** provider-agnostic adapter interface; default routing: frontier model (Claude-class) for assistants/agents and complex drafting; small fast model for classification, tagging, extraction, routing; embedding model for vectors; vision model for Photo AI. Routing table is config, swappable per tenant/task without product changes.
- **Cost control (NFR-27):** per-tenant monthly AI budget (plan entitlement) → gateway meters `ai_runs.cost_usd`; soft limit = degrade (cache-only, smaller models, batch deferral), hard limit = assistant explains and offers top-up. Response caching (semantic-keyed) and prompt caching are on by default.
- **Tenancy (NFR-29):** provider calls carry zero cross-tenant context; no training on tenant data; DPAs per provider; tenant-configurable provider allowlist and data-residency routing (enterprise).

## 3. RAG Architecture

**Pipeline:** outbox event → embedding worker → chunk → embed → upsert `embeddings` (idempotent by content hash) → HNSW index (RLS-scoped).

- **Corpus:** documents (extracted text, per-page), RFIs/submittals, daily reports, comments/messages, contracts, estimates/budget lines (structured-to-text renderings), safety records, supplier/sub history, plus curated construction reference content (CSI divisions, standard specs) in a shared platform corpus (clearly separated provenance).
- **Chunking:** semantic chunks 300–700 tokens with 60-token overlap; structured records rendered via templates ("PO-0231: 40 yd³ ready-mix from Apex Concrete, required 2026-08-12, $6,800, cost code 03-300…") — structure-aware beats raw dumps.
- **Retrieval:** hybrid — vector (pgvector cosine) + keyword (Postgres FTS) fused via RRF, then cross-encoder rerank (small model) of top-40 → top-8. **The retriever executes under the caller's AccessContext**: tenant RLS + project membership + external-share filters applied in-query. A user can never retrieve what they cannot open (FR-AI-1/2 — this is the load-bearing security property of the whole AI layer).
- **Freshness:** event-driven re-embedding within ~1 min of change; deletes/tombstones purge vectors synchronously with source soft-delete.
- **Citations:** every retrieved chunk carries `{entity_type, entity_id, title, snippet}` → surfaced as source chips in AIAnswerBlock (ui §7).

## 4. Memory & Embeddings

- **Working memory:** conversation thread (last-N + rolling summary) + surface context (`module`, `entity_ref` — the assistant always knows *where* the user is standing).
- **Durable memory (`ai_memories`):** user preferences ("Dana wants schedules in weeks"), tenant conventions (cost-code style, terminology, markup norms), learned corrections. Written only via explicit capture rules; user-visible and deletable (`/ai/memories`); expires where sensible. Memory is *never* a channel to leak data across permission scopes — memories store preferences and conventions, not record contents.
- **Embeddings:** 1024-dim (provider-abstracted); versioned by `embedding_model` column; re-embedding migration path = dual-write new column, cutover, drop.
- **Vector DB:** pgvector first (consistency + RLS, architecture §7); extraction triggers documented there. The retriever interface hides the store — swap requires zero product change.

## 5. Prompt Templates

- All production prompts live in the **template registry** (versioned, code-reviewed, in-repo `packages/ai/prompts/`): `id`, `version`, `task`, `system`, `variables`, `output_schema (zod)`, `eval_suite_ref`, `model_route`.
- Templates render with structured variables — user text is *always* a distinguished variable, never concatenated into instructions (injection defense §11).
- Output contracts are zod schemas; the gateway validates and retries-with-repair on schema miss. No free-text parsing of model output anywhere in the platform.
- Every `ai_runs` row records `prompt_template_id@version` — full reproducibility of any historical output.

## 6. Tool Calling / Function Calling

- **Registry:** tools are declared wrappers over application-layer use-cases: `{name, description, params_schema (zod→JSON-schema), permission_key, consequence_class, module}`. Auto-generated docs; CI forbids tools without permission keys.
- **Consequence classes:**
  - `read` — queries/reports (no gate)
  - `draft` — creates draft artifacts visible only to the user (no gate; e.g., draft PO, draft RFI)
  - `act` — mutates shared state (requires **explicit confirmation** via `/ai/actions/{id}/confirm` — FR-AI-3; the confirmation card shows a human-readable diff of exactly what will change)
  - `restricted` — financial approvals, permission changes, external sends: AI may *prepare* but a human must execute in-product (never confirmable in-chat)
- **Execution:** tool runs under the *user's* permission set (assistants) or a narrower declared permission set (autonomous agents §14) — never elevated. Every execution → `audit_log` with `ai_run_id`; every `act` is reversible (soft-delete/versioning) per FR-AI-6.
- **Loop guard:** max tool-call depth 6, cycle detection, per-run cost ceiling.

## 7. AI Module Specifications

Each module lists: surfaces, capabilities, inputs, autonomy ceiling at launch, KPIs.

### 7.1 Executive Assistant (M16)
- **Surface:** company dashboard + assistant; weekly proactive briefing (notification + portal card).
- **Capabilities:** NL Q&A over whole-company data ("which projects are trending under margin and why") with drill-through citations; anomaly surfacing (margin erosion, AR aging spikes, pipeline stalls); what-if sketches ("what does losing the Harbor bid do to Q4 revenue"); board-pack drafting.
- **Inputs:** projections (`projection_*`), financial ledgers, pipeline, schedule variance, safety KPIs.
- **Autonomy:** read + draft only. **KPIs:** exec WAU, question success rate, briefing open rate.

### 7.2 Project Assistant (M4) — MVP flagship
- **Surface:** project command center + omnipresent assistant panel.
- **Capabilities:** status summarization ("catch me up on Riverside"), risk flags with reasoning (schedule slip probability, budget pressure, stale RFIs), next-best-action queue, meeting-minute → action-item drafting, cross-record search.
- **Autonomy:** read + draft; `act` (create tasks, nudge assignees) behind confirmation. **KPIs:** daily opens/PM, suggestion acceptance, risk-flag lead time (spec §15.3).

### 7.3 Estimator AI (M2)
- **Capabilities:** line-item suggestion from scope text/drawings (with historical cost lookup from `cost_item_price_history`), quantity sanity checks ("drywall qty implies 3× the floor area"), pricing anomaly detection vs history and region, bid-leveling matrix from sub bids, win-price guidance from CRM history.
- **Autonomy:** draft only — estimates are money; nothing auto-applies (FR-EST-7). **KPIs:** suggested-line acceptance %, estimate cycle time, estimate-vs-actual variance improvement.

### 7.4 Procurement AI (M5)
- **Capabilities:** buy-timing recommendations (schedule need date − lead time − buffer), PO drafting from budget+schedule needs (FR-PROC-6), supplier scoring (on-time %, price index, dispute history), price benchmarking, delivery-risk alerts (promised vs need dates).
- **Autonomy:** draft POs; `act` (send PO) restricted to human execution. **KPIs:** stockout/late-material incidents ↓, draft-PO acceptance, realized savings vs benchmark.

### 7.5 Scheduling AI (M7)
- **Capabilities:** auto-sequencing draft from template + scope, delay-impact simulation (FR-SCH-6), weather-aware lookahead adjustment suggestions, critical-path risk scoring (float burn-rate), crew-conflict resolution options.
- **Autonomy:** draft + suggest; schedule mutations always confirmed. **KPIs:** slip lead-time (days of warning), replan time, forecast-vs-actual finish accuracy.

### 7.6 Equipment AI (M11)
- **Capabilities:** predictive maintenance (usage-hours vs service intervals + fault patterns), idle-asset detection with reassignment/return suggestions, rent-vs-buy analysis from utilization history.
- **Autonomy:** suggest; work-order creation behind confirmation. **KPIs:** utilization %, unplanned-downtime incidents, idle-days recovered.

### 7.7 Document AI (M3)
- **Capabilities:** classification & auto-filing, metadata extraction (sheet no, revision, discipline), summarization, spec/contract Q&A with page-level citations, drawing version-diff (changed-region detection), submittal-vs-spec conformance pre-check.
- **Autonomy:** auto-classify/file at high confidence (reversible, flagged); Q&A read-only. **KPIs:** filing accuracy, Q&A groundedness score, diff recall on test set.

### 7.8 Photo AI (M8)
- **Capabilities:** auto-tagging (trade, element, material), progress inference against schedule activities, defect/quality flagging → draft punch items (FR-TASK-4), safety-hazard detection (feeds 7.9), search-by-content ("photos of waterproofing at level 2").
- **Autonomy:** tagging auto-applies (reversible, violet-labeled); punch/safety items are drafts. **KPIs:** tag precision/recall, punch-draft acceptance, search success.

### 7.9 Safety AI (M12)
- **Capabilities:** incident triage/classification (severity, OSHA-recordability draft), hazard detection from field photos, compliance-gap alerts (expiring certs vs scheduled crews), trend analysis ("ladder incidents cluster on Site B mornings"), toolbox-talk topic suggestions from recent observations.
- **Autonomy:** suggest + draft; incident records are human-owned. **Sensitivity rule:** safety outputs never auto-close anything and always escalate on severity ≥ configurable threshold. **KPIs:** hazard-flag precision, cert-gap catches, near-miss reporting rate (should *rise*).

### 7.10 Financial AI (M9)
- **Capabilities:** margin-erosion early warning with causal decomposition (labor overrun vs material price vs scope creep), cost-to-complete forecasting (per cost code, confidence bands), cash-flow projection (FR-FIN-7), invoice anomaly detection (duplicate, price-drift vs PO, unusual patterns), CO impact analysis.
- **Autonomy:** read + draft strictly — `restricted` class for anything touching money movement. **KPIs:** forecast MAPE, alert lead-time, anomaly precision, projects-finishing-at-margin (spec G2).

### 7.11 Natural Language Search (cross-module)
- `/ai/search` + ⌘K fallback: NL → hybrid retrieval → typed, permission-filtered results with citations; query understanding maps to structured filters where possible ("open RFIs on Riverside older than 2 weeks" → filter query, not RAG — cheaper and exact). **KPI:** search success rate (result clicked/acted).

## 8. Confidence Scores

- Every scored output carries `confidence ∈ [0,1]` computed per task family: calibrated classifier probability (classification), retrieval-grounding coverage + self-consistency (RAG answers), historical acceptance-weighted heuristics (drafts), interval width (forecasts).
- **Calibration is maintained**: weekly job compares confidence buckets vs measured accuracy (`ai_runs.outcome`); drift > threshold pages the AI team and auto-widens escalation thresholds.
- **UX mapping (AIAnswerBlock):** ≥ 0.85 plain answer + sources; 0.6–0.85 hedged phrasing + "verify" prompt; < 0.6 → escalation behavior (§9). Numeric score visible on hover/tap; buckets, not decimals, in primary UI.

## 9. Escalation Rules (FR-AI-5)

| Trigger | Behavior |
|---------|----------|
| Confidence < task threshold | Answer withheld; assistant states what it found, what's uncertain, offers human-routed options ("ask Dana", "open the records") |
| Retrieval empty/contradictory | "I don't have grounds to answer" + closest sources — **never** a fluent guess |
| `act` tool failure/validation error | Surfaced verbatim with retry/handoff; no silent swallowing |
| Safety-critical content (incidents, structural, legal exposure) | Force-escalate to designated humans regardless of confidence; assistant may summarize, never conclude |
| Financial threshold (configurable, e.g. > $10k impact) | Draft-only + named-approver routing (maker/checker) |
| User frustration signals (repeated rejection, "that's wrong") | Offer human support path; log for eval mining |

## 10. Hallucination Prevention

Defense-in-depth, in order of leverage:

1. **Grounding mandate:** RAG answers must cite retrieved sources; the generator is instructed to answer *only* from provided context; a **groundedness checker** (small model) verifies claim-to-source entailment post-generation — failures are blocked and regenerated (one retry) or escalated.
2. **Structured outputs:** zod-validated schemas eliminate free-text invention in tool calls and extraction tasks.
3. **Numeric truth from SQL, not tokens:** any figure (budget, margin, count) is fetched by a `read` tool and interpolated — models never "remember" tenant numbers.
4. **Refusal is a feature:** templates reward "not enough information" (§9); eval suites include unanswerable questions and score refusal correctness.
5. **Provenance separation:** platform reference corpus vs tenant data tagged; answers must not present reference-book content as tenant fact.
6. **Feedback loop:** every thumbs-down/rejection lands in the eval mining queue (§13) with full run context.

## 11. AI Security

- **Prompt injection:** retrieved content and user uploads are *data*, delimited and instruction-stripped; templates instruct the model to treat document text as untrusted; tool registry means injected text cannot mint new capabilities; `act` confirmation gate caps blast radius; injection canary suite runs in CI against every template change.
- **Permissions (FR-AI-1):** AccessContext threading end-to-end (retrieval, tools, memory); assistants in external portals (client/sub/supplier) run with external-share scope and a restricted tool set (read + message drafts only).
- **Data egress:** gateway is the only path to providers; payload logging with PII redaction; no tenant data in provider training (contractual + flags); enterprise: provider allowlist, regional routing, optional self-hosted open-weights route.
- **Abuse controls:** per-user/tenant AI rate limits (api §1.6), cost ceilings per run, content-safety filter on generations destined for external portals.

## 12. AI Monitoring

- **Golden signals per module:** volume, latency (p50/p95 to-first-token and total), cost/run, cache hit rate, error rate, schema-repair rate, confidence distribution, outcome distribution (`shown→accepted/rejected/auto_applied/escalated`).
- Dashboards per prompt-template version; canary alerts on acceptance-rate drops (>10% WoW) or cost spikes — a template regression is an *incident*, with rollback to prior version (registry makes this one config change).
- All model I/O traced (OTel) and joined to `ai_runs`; sampling-based human review queue (1–5%) per module, weighted toward low-confidence and rejected runs.

## 13. AI Evaluation

- **Per-template eval suites** (in-repo, run in CI): golden sets (input → expected output/rubric), LLM-judge rubrics for open-ended tasks (double-judged, spot-audited by humans), injection & refusal suites, tenancy-leak probes (attempt cross-tenant retrieval in test harness — must return zero).
- **Promotion gates:** a template/model change ships only if evals ≥ baseline on accuracy, groundedness, refusal, cost. Autonomy promotions (§1 law 3) additionally require ≥ 4 weeks production metrics above threshold (e.g., auto-filing requires ≥ 98% classification precision over ≥ 5k runs).
- **Continuous:** production outcomes stream into weekly eval reports; rejected-run mining generates new eval cases (the flywheel: spec §11.6).

## 14. Offline AI (field)

- MVP: AI features degrade gracefully offline — capture everything (voice memos, photos) locally; AI processing (transcription→report draft, tagging) runs on sync. UI marks "AI pending sync" (violet clock chip).
- Phase 2+: on-device small models for instant photo tagging and voice-to-text (platform APIs / distilled models) with server reconciliation (server output wins ties, both logged).
- No tenant corpus is ever mirrored to devices beyond the user's working set (sync scope = AI scope).

## 15. Future AI Agents (V3 horizon — design now, ship later)

- **Agent = declared identity:** `{name, purpose, permission_set (narrow, explicit), tool allowlist, budget, triggers, escalation contacts}` — provisioned like a user, visible in admin, fully audited.
- **Planned agents:** Procurement Agent (watch schedule/stock → draft+route POs end-to-end), Billing Agent (assemble monthly pay-app from progress data → route for approval), Compliance Agent (chase expiring certs/insurance with sub-portal messages), Closeout Agent (assemble O&M/warranty package).
- **Ladder:** each agent launches at `draft` autonomy and earns `act` per §13 promotion gates; human "pause agent" kill-switch per tenant; all agent actions reversible and attributable (`actor_type='ai'`, `ai_run_id`).
- The tool registry, consequence classes, and audit spine above are *already* the agent runtime — no re-architecture, only new agent definitions.

---

*End of `ai-spec.md` v1.0.*
