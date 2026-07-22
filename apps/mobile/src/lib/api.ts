// Thin fetch wrapper over the ConstructionOS API (api.md §1.2's envelope:
// { data } on success, { error: { code, message, trace_id } } on failure).
// architecture.md §6: "the network is an optimization, never a
// dependency" — every caller of this module already has a local-first
// path that works without it; this is only ever invoked for auth and the
// sync protocol (POST /sync/mutations, GET /sync/delta) never for the
// field's primary read/write path.

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${API_URL}/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = (await response.json().catch(() => null)) as
    | { data: T }
    | { error: { code: string; message: string; trace_id: string } }
    | null;

  if (!response.ok || !json || "error" in json) {
    const err = json && "error" in json ? json.error : null;
    throw new ApiError(err?.message ?? "request failed", err?.code ?? "unknown", response.status);
  }

  return json.data;
}
