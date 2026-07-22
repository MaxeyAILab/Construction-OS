import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";

// architecture.md §13: object store holds only bytes; this table is the
// Postgres-side metadata record ("the object store holds only bytes...
// versioning is a DB concern"). Deliberately does NOT carry an
// entity_type/entity_id attachment column — which entity a file belongs to
// is a concern of whichever consuming module attaches it (Documents'
// versions, Photos, ...), each via its own FK to files.id, per
// architecture.md §4.2's module-boundary rule. This table only tracks the
// blob itself and its processing pipeline state.
export const files = pgTable(
  "files",
  {
    ...tenantColumns(),
    // S3-compatible object key, `tenant/{tenant_id}/uploads/{file_id}/...`
    // (architecture.md §13's per-tenant key layout).
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    // Client-declared at upload-initiation; reconciled against the real
    // object size (S3 HeadObject) once the processing worker runs.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // Present only while a multipart upload is in progress; cleared once
    // completed or aborted.
    multipartUploadId: text("multipart_upload_id"),
    status: text("status").notNull().default("pending"),
    checksumSha256: text("checksum_sha256"),
    thumbnailKey: text("thumbnail_key"),
    // Raw scanner output, e.g. {"signature": "Eicar-Test-Signature"} when infected.
    scanResult: jsonb("scan_result"),
  },
  (table) => [
    check(
      "ck_files_status",
      sql`${table.status} in ('pending', 'uploaded', 'scanning', 'clean', 'infected', 'scan_failed')`,
    ),
    uniqueIndex("ux_files_tenant_object_key").on(table.tenantId, table.objectKey),
    index("ix_files_tenant_status").on(table.tenantId, table.status),
  ],
);
