// roadmap.md Phase 1C "Field UX hardening: high-contrast, 52 px targets,
// voice notes" — a hands-free field annotation attached to a daily report
// or punch item. Local-only in this pass: database.md has no server-side
// voice-note entity yet, so this doesn't invent one ahead of spec — same
// "smallest spec-consistent option, flag the gap" precedent as this
// session's other documented deferrals (weather auto-fill, EXIF parsing).
// Recording and playback both work fully offline; only cross-device sync
// is deferred (follow-up: a fileId FK once a server entity exists, same
// shape Photos already uses).
import { Audio } from "expo-av";
import { getDb } from "../../lib/db";
import { uuidv7 } from "../../lib/uuid";

export interface VoiceNote {
  id: string;
  entityType: string;
  entityId: string;
  localUri: string;
  durationMillis: number;
  createdAt: string;
}

interface VoiceNoteRow {
  id: string;
  entity_type: string;
  entity_id: string;
  local_uri: string;
  duration_millis: number;
  created_at: string;
}

function fromRow(row: VoiceNoteRow): VoiceNote {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    localUri: row.local_uri,
    durationMillis: row.duration_millis,
    createdAt: row.created_at,
  };
}

export async function listVoiceNotes(entityType: string, entityId: string): Promise<VoiceNote[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VoiceNoteRow>(
    "SELECT * FROM voice_notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC",
    [entityType, entityId],
  );
  return rows.map(fromRow);
}

export async function saveVoiceNote(entityType: string, entityId: string, localUri: string, durationMillis: number): Promise<VoiceNote> {
  const db = await getDb();
  const id = uuidv7();
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO voice_notes (id, entity_type, entity_id, local_uri, duration_millis, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, entityType, entityId, localUri, durationMillis, now],
  );
  return { id, entityType, entityId, localUri, durationMillis, createdAt: now };
}

let activeRecording: Audio.Recording | null = null;

export async function startRecording(): Promise<void> {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Microphone permission denied");

  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  activeRecording = recording;
}

export async function stopRecording(): Promise<{ uri: string; durationMillis: number }> {
  if (!activeRecording) throw new Error("No recording in progress");
  await activeRecording.stopAndUnloadAsync();
  const status = await activeRecording.getStatusAsync();
  const uri = activeRecording.getURI();
  activeRecording = null;
  if (!uri) throw new Error("Recording produced no file");
  return { uri, durationMillis: status.durationMillis ?? 0 };
}

export async function playVoiceNote(localUri: string): Promise<void> {
  const { sound } = await Audio.Sound.createAsync({ uri: localUri });
  await sound.playAsync();
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) void sound.unloadAsync();
  });
}
