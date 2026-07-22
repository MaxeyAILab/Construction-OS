import { S3Client } from "@aws-sdk/client-s3";
import type { Env } from "../../../config/env";

export const S3_CLIENT = Symbol("S3_CLIENT");
export const S3_BUCKET = Symbol("S3_BUCKET");

// Constructing an S3Client never dials the network — credentials/endpoint
// are only used on the first actual command — so this is safe to build
// eagerly at module-init time even against unconfigured/placeholder env
// values (config/env.ts's S3_* vars all default rather than require).
export function createS3Client(
  env: Pick<Env, "S3_REGION" | "S3_ENDPOINT" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY" | "S3_FORCE_PATH_STYLE">,
): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
    ...(env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY && {
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      }),
  });
}
