import { meter } from "./metrics";

// architecture.md §15: "queue depth/DLQ alarms" — every durable JetStream
// consumer (notifications, audit, ...) shares this shape (ack / nak-then-
// retry / give-up-and-dead-letter), so one counter pair covers all of them
// via a `consumer` attribute rather than each worker rolling its own.
const consumedTotal = meter.createCounter("events_consumed_total", {
  description: "Outbox events consumed off the JetStream events stream, by outcome",
});
const deadLetteredTotal = meter.createCounter("events_dead_lettered_total", {
  description: "Outbox events given up on after exhausting delivery attempts",
});

export function recordConsumed(consumer: string, subject: string, outcome: "ack" | "nak"): void {
  consumedTotal.add(1, { consumer, subject, outcome });
}

export function recordDeadLettered(consumer: string, subject: string): void {
  deadLetteredTotal.add(1, { consumer, subject });
}
