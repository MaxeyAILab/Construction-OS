// Local-first photo capture (architecture.md §6, roadmap.md's "Photo
// capture pipeline (offline, EXIF, resumable)" row, FR-FIELD-3). A photo
// is queued to SQLite the instant it's captured — src/lib/photo-upload.ts
// drains the queue opportunistically, same "network is an optimization"
// split as the rest of the field app.
import { getDb } from "../../lib/db";
import { uuidv7 } from "../../lib/uuid";

export interface CapturePhotoInput {
  localUri: string;
  contentType: string;
  sizeBytes: number;
  projectId: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  geoLat?: number | undefined;
  geoLng?: number | undefined;
  heading?: number | undefined;
  deviceId?: string | undefined;
}

export interface QueuedPhoto {
  id: string;
  localUri: string;
  status: "queued" | "uploading" | "uploaded" | "failed";
}

export async function capturePhoto(input: CapturePhotoInput): Promise<QueuedPhoto> {
  const db = await getDb();
  const id = uuidv7();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO photo_queue (id, project_id, entity_type, entity_id, local_uri, content_type, size_bytes, taken_at, geo_lat, geo_lng, heading, device_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [
      id,
      input.projectId,
      input.entityType ?? null,
      input.entityId ?? null,
      input.localUri,
      input.contentType,
      input.sizeBytes,
      now,
      input.geoLat ?? null,
      input.geoLng ?? null,
      input.heading ?? null,
      input.deviceId ?? null,
      now,
    ],
  );

  return { id, localUri: input.localUri, status: "queued" };
}

interface PhotoQueueRow {
  id: string;
  local_uri: string;
  status: "queued" | "uploading" | "uploaded" | "failed";
}

export async function listQueuedPhotos(entityType: string, entityId: string): Promise<QueuedPhoto[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PhotoQueueRow>(
    "SELECT id, local_uri, status FROM photo_queue WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC",
    [entityType, entityId],
  );
  return rows.map((r) => ({ id: r.id, localUri: r.local_uri, status: r.status }));
}
