// Local-first offline drawing viewer cache (architecture.md §6, roadmap.md's
// "Field tasks/punch + drawing viewer offline" row, FR-DOC-5). The server
// pins exactly one published drawing set per project (GET /sync/working-set)
// — this mirrors that set's sheets into SQLite so the viewer works without
// connectivity once a sheet has been downloaded once.
import * as FileSystem from "expo-file-system";
import { getDb } from "../../lib/db";

export interface WorkingSetDrawingSheet {
  documentVersionId: string;
  sortOrder: number;
  downloadUrl: string;
}

export interface WorkingSetDrawingSet {
  id: string;
  name: string;
  sheets: WorkingSetDrawingSheet[];
}

export interface LocalDrawingSheet {
  documentVersionId: string;
  projectId: string;
  drawingSetId: string;
  drawingSetName: string;
  sortOrder: number;
  downloadUrl: string;
  contentType: string | null;
  localUri: string | null;
  downloadedAt: string | null;
}

interface DrawingSheetRow {
  document_version_id: string;
  project_id: string;
  drawing_set_id: string;
  drawing_set_name: string;
  sort_order: number;
  download_url: string;
  content_type: string | null;
  local_uri: string | null;
  downloaded_at: string | null;
}

function fromRow(row: DrawingSheetRow): LocalDrawingSheet {
  return {
    documentVersionId: row.document_version_id,
    projectId: row.project_id,
    drawingSetId: row.drawing_set_id,
    drawingSetName: row.drawing_set_name,
    sortOrder: row.sort_order,
    downloadUrl: row.download_url,
    contentType: row.content_type,
    localUri: row.local_uri,
    downloadedAt: row.downloaded_at,
  };
}

// Mirrors the server's "one published set per project" invariant locally:
// called after every GET /sync/working-set pull, it replaces the project's
// cached sheet rows to match — but a sheet that's still part of the
// (possibly re-published) set keeps its existing local_uri/content_type/
// downloaded_at rather than being wiped, so it isn't re-downloaded for no
// reason.
export async function upsertDrawingSet(projectId: string, drawingSet: WorkingSetDrawingSet | null): Promise<void> {
  const db = await getDb();
  const keepIds = drawingSet?.sheets.map((s) => s.documentVersionId) ?? [];

  await db.withTransactionAsync(async () => {
    if (keepIds.length > 0) {
      const placeholders = keepIds.map(() => "?").join(",");
      await db.runAsync(
        `DELETE FROM drawing_sheets WHERE project_id = ? AND document_version_id NOT IN (${placeholders})`,
        [projectId, ...keepIds],
      );
    } else {
      await db.runAsync("DELETE FROM drawing_sheets WHERE project_id = ?", [projectId]);
    }

    if (!drawingSet) return;

    for (const sheet of drawingSet.sheets) {
      await db.runAsync(
        `INSERT INTO drawing_sheets (document_version_id, project_id, drawing_set_id, drawing_set_name, sort_order, download_url, content_type, local_uri, downloaded_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
         ON CONFLICT(document_version_id) DO UPDATE SET
           project_id = excluded.project_id, drawing_set_id = excluded.drawing_set_id,
           drawing_set_name = excluded.drawing_set_name, sort_order = excluded.sort_order,
           download_url = excluded.download_url`,
        [sheet.documentVersionId, projectId, drawingSet.id, drawingSet.name, sheet.sortOrder, sheet.downloadUrl],
      );
    }
  });
}

export async function listDrawingSheets(projectId: string): Promise<LocalDrawingSheet[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DrawingSheetRow>(
    "SELECT * FROM drawing_sheets WHERE project_id = ? ORDER BY sort_order ASC",
    [projectId],
  );
  return rows.map(fromRow);
}

export async function listCachedDrawingProjectIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ project_id: string }>("SELECT DISTINCT project_id FROM drawing_sheets");
  return rows.map((r) => r.project_id);
}

export async function getDrawingSheet(documentVersionId: string): Promise<LocalDrawingSheet | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DrawingSheetRow>("SELECT * FROM drawing_sheets WHERE document_version_id = ?", [
    documentVersionId,
  ]);
  return row ? fromRow(row) : null;
}

// downloadUrl is a presigned GET (StorageService.createDownloadUrl) — no
// bearer token needed, same as the web app's document downloads.
export async function downloadDrawingSheet(sheet: LocalDrawingSheet): Promise<LocalDrawingSheet> {
  const dir = `${FileSystem.documentDirectory}drawings/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const localUri = `${dir}${sheet.documentVersionId}`;

  const result = await FileSystem.downloadAsync(sheet.downloadUrl, localUri);
  const contentType = result.headers["Content-Type"] ?? result.headers["content-type"] ?? null;
  const downloadedAt = new Date().toISOString();

  const db = await getDb();
  await db.runAsync("UPDATE drawing_sheets SET local_uri = ?, content_type = ?, downloaded_at = ? WHERE document_version_id = ?", [
    result.uri,
    contentType,
    downloadedAt,
    sheet.documentVersionId,
  ]);

  return { ...sheet, localUri: result.uri, contentType, downloadedAt };
}
