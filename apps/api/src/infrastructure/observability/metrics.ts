import { metrics, trace } from "@opentelemetry/api";

// Pulled from the OTel API's global provider registry rather than the SDK
// directly: before tracing.ts calls `sdk.start()` (or in tests, where it
// never does), these resolve to OTel's built-in no-op implementations, so
// every call site here works unconditionally without an `if (started)` check.
export const meter = metrics.getMeter("constructionos-api");
export const tracer = trace.getTracer("constructionos-api");
