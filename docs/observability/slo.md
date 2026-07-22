# SLOs & alerting

architecture.md §15: "SLOs & alerting: availability and latency SLOs per
NFR-1/8 with burn-rate alerts; RED dashboards per module; queue depth/DLQ
alarms; sync-failure rate is a first-class SLO (field trust, NFR-10)."

Alerting rules implementing the burn-rate SLOs below live in
`../../infra/observability/alerts/api-slo.rules.yml` (Prometheus/Mimir
alerting-rule format, provisioned into the local stack — see
`../../infra/observability/README.md`). They were written against the
metric names this codebase defines, but not evaluated against a live
Prometheus/Mimir instance in this environment (no Docker daemon
available here) — validate with `promtool check rules` and a real burn
before relying on them for paging.

## Availability (NFR-8)

- **SLO:** 99.9% of requests succeed (non-5xx) per calendar month
  (enterprise tier: 99.95%). Error budget: 43m 50s/month at 99.9%.
- **SLI:** `sum(rate(http_server_request_duration_seconds_count{http_status_code!~"5.."}[window])) / sum(rate(http_server_request_duration_seconds_count[window]))`
- **Burn-rate alerts** (Google SRE workbook multi-window/multi-burn-rate
  pattern — catches both a fast, page-worthy burn and a slow, ticket-worthy
  one without either being too noisy or too slow):
  - Fast burn: 14.4x burn rate sustained over both a 1h and a 5m window →
    page (exhausts a 30-day budget in ~2 days if it keeps up).
  - Slow burn: 6x burn rate sustained over both a 6h and a 30m window →
    ticket (exhausts the budget in ~5 days).

## Latency (NFR-1)

- **SLO:** P95 ≤ 300ms, P99 ≤ 800ms for core read operations (excludes
  heavy analytics/AI endpoints, which have their own budget — not built
  yet, so no exclusion label exists in the metric today; flagged as a
  follow-up once those endpoints exist).
- **SLI:** `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket[window])))`
- **Burn-rate alerts:** same multi-window/multi-burn-rate shape as
  availability, but the "bad event" is a request exceeding the 300ms (P95)
  or 800ms (P99) target rather than a 5xx — see the rules file for the
  exact ratio queries (fraction of requests over threshold, burned against
  the 5% error-budget allowance implied by a 95th-percentile target).

## Queue depth / DLQ (architecture.md §15, no NFR number — operational, not
customer-facing)

- **SLO:** zero dead-lettered events, ever. Any dead-letter is a bug (a
  poison message, a schema the consumer predates) that needs a human, not
  a transient blip to average away.
- **SLI:** `events_dead_lettered_total` (counter, per consumer/subject —
  `infrastructure/observability/consumer-metrics.ts`).
- **Alert:** fire on `increase(events_dead_lettered_total[5m]) > 0` — no
  burn-rate math needed, any nonzero rate is actionable immediately.
- **Secondary:** `outbox_relay_queue_depth` (gauge) sustained above a
  threshold for 10m indicates the relay can't keep up with outbox writes —
  alert before it becomes a customer-visible delay.

## Sync-failure rate (NFR-10, field trust)

**Not yet instrumented.** NFR-10 requires "field data captured offline
shall never be lost and shall reconcile deterministically" — this needs a
sync-failure-rate SLI from the offline-first mobile sync layer
(`packages/sync`, roadmap.md Phase 1B+), which doesn't exist yet. Flagged
as a follow-up: add a sync-attempt/sync-failure counter to that module
when it's built, and a corresponding zero-tolerance alert here, mirroring
the DLQ pattern above.
