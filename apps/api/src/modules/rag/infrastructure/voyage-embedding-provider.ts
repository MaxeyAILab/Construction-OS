import type { EmbeddingProvider } from "../domain/embedding-provider";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
// voyage-3: 1024-dim output — matches ai-spec.md §4's stated dimension
// exactly (Anthropic's recommended embeddings partner; Anthropic itself
// doesn't offer an embeddings endpoint).
const MODEL = "voyage-3";

interface VoyageEmbeddingsResponse {
  data: { embedding: number[]; index: number }[];
}

// Unlike AnthropicProvider (whose SDK client tolerates a missing key
// until the first real request), this is a plain fetch call — the
// missing-key check happens explicitly here, at call time, not at
// construction, same "unconfigured is fine until actually invoked"
// contract as every other lazily-dialed external service in this app.
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string | undefined) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error("VOYAGE_API_KEY is not configured");

    const response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: MODEL }),
    });
    if (!response.ok) {
      throw new Error(`Voyage embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as VoyageEmbeddingsResponse;
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
