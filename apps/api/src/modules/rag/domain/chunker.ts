import { createHash } from "node:crypto";

// ai-spec.md §3: "semantic chunks 300-700 tokens with 60-token overlap".
// Word count approximates token count (no tokenizer dependency) — close
// enough for chunk-sizing purposes; most rendered entities (a task's
// title+description, an RFI's question, a daily report's narrative) fit
// in a single chunk today, but longer text still splits correctly.
const MAX_CHUNK_WORDS = 700;
const OVERLAP_WORDS = 60;

export function chunkText(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= MAX_CHUNK_WORDS) return [words.join(" ")];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + MAX_CHUNK_WORDS, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - OVERLAP_WORDS;
  }
  return chunks;
}

// database.md §19: "idempotent by content hash" — re-embedding the same
// chunk text twice (e.g. two updates that don't change this particular
// chunk) is a no-op via ux_embeddings_tenant_entity_chunk_hash.
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
