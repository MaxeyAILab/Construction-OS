// architecture.md §15: "OpenTelemetry everywhere — traces, metrics, logs
// correlated by trace_id/tenant_id/user_id(hashed)". This module MUST be the
// first thing main.ts imports (before reflect-metadata, fastify, ioredis,
// etc.) — OTel's auto-instrumentations patch modules via require-in-the-
// middle hooks, which only catches modules `require()`-d *after* the
// instrumentation registers. In this CommonJS build, import order in
// main.ts is require() order, so this must stay import #1 there.
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = "constructionos-api";

// Tests run this file's module graph transitively (every module ends up
// importing something that imports something in `src/`); starting a real
// SDK there would try to dial a collector on every vitest run and add
// noisy diagnostics. The exported `meter`/`tracer` in metrics.ts still work
// fine against OTel's global no-op providers when the SDK never starts.
const shouldStart = process.env.NODE_ENV !== "test";

if (shouldStart) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new FastifyInstrumentation(),
      new IORedisInstrumentation(),
      new NestInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((err: unknown) => console.error("otel sdk shutdown failed", err))
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
