// Minimal client-side session storage. Real refresh-rotation handling
// (silent refresh on 401, secure httpOnly-cookie storage) is a larger web
// auth workstream — this is the smallest thing that makes the admin UI
// (this task) actually work end to end against the real API.
const ACCESS_TOKEN_KEY = "constructionos.accessToken";
const REFRESH_TOKEN_KEY = "constructionos.refreshToken";

export function saveSession(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
