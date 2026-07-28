import { createHmac } from "node:crypto";

// api.md §16.3: "HMAC-SHA256 signature header (X-COS-Signature, timestamped,
// replay-protected)". Stripe-style construction (sign `${timestamp}.${body}`,
// not the body alone) so a receiver can reject stale/replayed deliveries by
// checking the timestamp before verifying the signature.
export const SIGNATURE_HEADER = "X-COS-Signature";
export const TIMESTAMP_HEADER = "X-COS-Timestamp";

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}
