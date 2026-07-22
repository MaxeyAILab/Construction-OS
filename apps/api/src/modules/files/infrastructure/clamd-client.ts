import { createScanner, type ClamdScanner } from "clamdjs";
import type { Env } from "../../../config/env";

export const CLAMD_SCANNER = Symbol("CLAMD_SCANNER");

// createScanner() only stores host/port — like the S3 client, it doesn't
// dial clamd until the first scan, so this is safe to construct eagerly
// even when no clamd daemon is actually running yet (env.ts defaults
// CLAMAV_HOST/PORT rather than requiring them).
export function createClamdScanner(env: Pick<Env, "CLAMAV_HOST" | "CLAMAV_PORT">): ClamdScanner {
  return createScanner(env.CLAMAV_HOST, env.CLAMAV_PORT);
}
