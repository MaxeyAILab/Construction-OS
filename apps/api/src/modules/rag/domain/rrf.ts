// ai-spec.md §3: "hybrid — vector (pgvector cosine) + keyword (Postgres
// FTS) fused via RRF." Reciprocal Rank Fusion: a result's score is the
// sum, across every ranked list it appears in, of 1/(k + rank) — pure
// rank-based (no need to normalize incompatible score scales between
// cosine distance and ts_rank), k=60 is the standard RRF constant from
// the original paper (Cormack et al.).
const RRF_K = 60;

export function fuseRrf<T extends { id: string }>(...rankedLists: T[][]): (T & { score: number })[] {
  const scores = new Map<string, number>();
  const rows = new Map<string, T>();

  for (const list of rankedLists) {
    list.forEach((row, index) => {
      const rank = index + 1;
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank));
      rows.set(row.id, row);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...(rows.get(id) as T), score }));
}
