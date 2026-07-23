// Resumable background upload for queued photos (roadmap.md's "Photo
// capture pipeline (offline, EXIF, resumable)" row, FR-FIELD-3). Mirrors
// the server's presigned single-PUT / multipart flow (apps/api's
// FileUploadService) rather than a simpler "just POST the bytes" client —
// the server already branches on an 8MB threshold, so this file matches
// that exactly. Every step persists its progress to `photo_queue` first,
// so a killed app or dropped connection resumes from the last completed
// part instead of restarting the whole photo.
import * as FileSystem from "expo-file-system";
import { apiRequest } from "./api";
import type { Session } from "./auth";
import { getDb } from "./db";

// Mirrors FileUploadService's MULTIPART_PART_SIZE_BYTES — the client must
// slice parts the same size the server pre-signed each part URL for.
const PART_SIZE_BYTES = 8 * 1024 * 1024;

interface QueuedPhotoRow {
  id: string;
  project_id: string;
  entity_type: string | null;
  entity_id: string | null;
  local_uri: string;
  content_type: string;
  size_bytes: number;
  taken_at: string;
  geo_lat: number | null;
  geo_lng: number | null;
  heading: number | null;
  device_id: string | null;
  file_id: string | null;
  upload_mode: "single" | "multipart" | null;
  upload_id: string | null;
  upload_url: string | null;
  parts_json: string | null;
}

interface PhotoPart {
  partNumber: number;
  url: string;
  etag: string | null;
}

type InitiateResult =
  | { fileId: string; uploadMode: "single"; uploadUrl: string }
  | { fileId: string; uploadMode: "multipart"; uploadId: string; parts: { partNumber: number; url: string }[] };

export async function uploadQueuedPhotos(session: Session): Promise<{ uploaded: number; failed: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<QueuedPhotoRow>(
    "SELECT * FROM photo_queue WHERE status IN ('queued', 'uploading') ORDER BY created_at ASC LIMIT 5",
  );

  let uploaded = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await uploadOne(session, row);
      uploaded += 1;
    } catch (err) {
      failed += 1;
      await db.runAsync("UPDATE photo_queue SET status = 'failed', error_message = ? WHERE id = ?", [
        err instanceof Error ? err.message : String(err),
        row.id,
      ]);
    }
  }

  return { uploaded, failed };
}

async function uploadOne(session: Session, row: QueuedPhotoRow): Promise<void> {
  const db = await getDb();

  let fileId = row.file_id;
  let uploadMode = row.upload_mode;
  let uploadUrl = row.upload_url;
  let parts: PhotoPart[] = row.parts_json ? (JSON.parse(row.parts_json) as PhotoPart[]) : [];

  if (!fileId) {
    const filename = row.local_uri.split("/").pop() ?? "photo.jpg";
    const initiated = await apiRequest<InitiateResult>("/photos/initiate", {
      method: "POST",
      token: session.accessToken,
      body: { filename, contentType: row.content_type, sizeBytes: row.size_bytes },
    });

    fileId = initiated.fileId;
    uploadMode = initiated.uploadMode;
    if (initiated.uploadMode === "single") {
      uploadUrl = initiated.uploadUrl;
    } else {
      parts = initiated.parts.map((p) => ({ ...p, etag: null }));
    }

    await db.runAsync(
      "UPDATE photo_queue SET status = 'uploading', file_id = ?, upload_mode = ?, upload_url = ?, upload_id = ?, parts_json = ? WHERE id = ?",
      [
        fileId,
        uploadMode,
        uploadUrl ?? null,
        initiated.uploadMode === "multipart" ? initiated.uploadId : null,
        JSON.stringify(parts),
        row.id,
      ],
    );
  }

  if (uploadMode === "single") {
    await FileSystem.uploadAsync(uploadUrl!, row.local_uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": row.content_type },
    });
  } else {
    parts = await uploadRemainingParts(row, parts);
  }

  const completed = await apiRequest<{ id: string }>("/photos/complete", {
    method: "POST",
    token: session.accessToken,
    body: {
      fileId,
      parts: uploadMode === "multipart" ? parts.map(({ partNumber, etag }) => ({ partNumber, etag })) : undefined,
      projectId: row.project_id,
      entityType: row.entity_type ?? undefined,
      entityId: row.entity_id ?? undefined,
      takenAt: row.taken_at,
      geoLat: row.geo_lat ?? undefined,
      geoLng: row.geo_lng ?? undefined,
      heading: row.heading ?? undefined,
      deviceId: row.device_id ?? undefined,
    },
  });

  await db.runAsync("UPDATE photo_queue SET status = 'uploaded', photo_id = ? WHERE id = ?", [completed.id, row.id]);
}

async function uploadRemainingParts(row: QueuedPhotoRow, parts: PhotoPart[]): Promise<PhotoPart[]> {
  const db = await getDb();

  for (const part of parts) {
    if (part.etag) continue; // already acked in a prior (interrupted) attempt — resume past it

    const position = (part.partNumber - 1) * PART_SIZE_BYTES;
    const length = Math.min(PART_SIZE_BYTES, row.size_bytes - position);
    const base64 = await FileSystem.readAsStringAsync(row.local_uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });
    const bytes = base64ToBytes(base64);

    const response = await fetch(part.url, { method: "PUT", body: bytes });
    const etag = response.headers.get("etag") ?? response.headers.get("ETag");
    if (!response.ok || !etag) throw new Error(`part ${part.partNumber} upload failed`);
    part.etag = etag;

    // Persist after every part, not just at the end — this is what makes
    // resume-from-the-right-part actually work after a crash mid-upload.
    await db.runAsync("UPDATE photo_queue SET parts_json = ? WHERE id = ?", [JSON.stringify(parts), row.id]);
  }

  return parts;
}

// React Native/Hermes has no global atob — same reasoning as auth.ts's
// base64UrlDecode, but this one must produce raw bytes (a PUT body),
// not a JS string.
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "");
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let outputIndex = 0;

  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[outputIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return bytes;
}
