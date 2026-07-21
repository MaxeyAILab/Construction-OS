import { getAccessToken } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Unwraps the api.md §1.2 { data } / { error } envelope so callers just
// get the payload or a thrown ApiError.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(
      body.error?.code ?? "unknown_error",
      body.error?.message ?? "request failed",
      response.status,
    );
  }
  return body.data as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
