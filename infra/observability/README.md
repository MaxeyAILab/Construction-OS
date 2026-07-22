# Observability stack (local / self-hosted MVP)

Implements architecture.md §15: OTel Collector → Grafana LGTM, self-hosted.

## Run it

```sh
docker compose up -d
```

- Grafana: http://localhost:3000 (anonymous admin access — `docker-compose.yml`'s
  `GF_AUTH_*` vars are dev-only; never carry them into a shared environment)
- OTLP ingest: `http://localhost:4318` (HTTP) / `4317` (gRPC)

Point `apps/api` at it:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

`apps/api/src/infrastructure/observability/tracing.ts` defaults to that same
URL, so this is only needed if the collector runs somewhere else.

## What's provisioned

- `dashboards/api-red.json` — request rate / error rate / P95+P99 latency
  against `http.server.request.duration` (OTel's stable HTTP server
  semantic-convention metric). The exact Prometheus name the collector
  exposes it under (`http_server_request_duration_seconds_*`) was not
  verified against a live collector in this environment — check Grafana
  Explore once the stack is actually running and adjust the panel queries
  if it differs.
- `dashboards/queue-dlq.json` — outbox relay queue depth, relay throughput
  (claimed vs. published), relay batch duration (P95), and dead-lettered /
  consumed events per durable JetStream consumer. These use metric names
  this codebase defines itself (`infrastructure/observability/metrics.ts`,
  `consumer-metrics.ts`, `relay.service.ts`, `relay.worker.ts`), so they're
  exact by construction.

## Verification status

This container has no Docker daemon available, so the stack itself was
**not** run or visually verified end-to-end here — only the app-side OTel
instrumentation (`apps/api`) was verified against a real request/response
cycle (traces exported, logs correlated with `trace_id`/`tenant_id`/
`userIdHash`, custom metrics recorded). Bring the stack up in an
environment with Docker and confirm the dashboards render before relying
on them for on-call.

## SLOs & alerting

See `../../docs/observability/slo.md` and `alerts/api-slo.rules.yml`.
