// Session management: token persistence (expo-secure-store) + login/logout
// against POST /auth/login|refresh|logout (packages/schemas/src/auth.ts's
// loginSchema). architecture.md §6: auth is the one thing a field worker
// truly cannot do offline, so this module is the sole non-local-first path
// besides src/lib/sync.ts.
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createElement } from "react";
import type { loginSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { apiRequest, ApiError } from "./api";

export type LoginInput = z.infer<typeof loginSchema>;

const ACCESS_TOKEN_KEY = "cos.accessToken";
const REFRESH_TOKEN_KEY = "cos.refreshToken";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  companyId: string;
}

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  sessionId: string;
  exp: number;
}

// React Native/Hermes has no global atob — decode base64url by hand
// rather than pull in a polyfill dependency for one JWT payload read.
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const char of base64) {
    if (char === "=") break;
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function decodeAccessToken(token: string): AccessTokenPayload {
  const [, payload] = token.split(".");
  return JSON.parse(base64UrlDecode(payload!)) as AccessTokenPayload;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
  roles: string[];
}

function toSession(response: LoginResponse): Session {
  const payload = decodeAccessToken(response.accessToken);
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    userId: payload.sub,
    tenantId: payload.tenantId,
    roles: payload.roles,
  };
}

export async function login(input: LoginInput): Promise<Session> {
  const response = await apiRequest<LoginResponse>("/auth/login", { method: "POST", body: input });
  const session = toSession(response);
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
  return session;
}

export async function restoreSession(): Promise<Session | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;

  try {
    return toSession({ accessToken, refreshToken, expiresAt: "", companyId: "" });
  } catch {
    return refreshSession(refreshToken);
  }
}

export async function refreshSession(refreshToken: string): Promise<Session | null> {
  try {
    const response = await apiRequest<Omit<LoginResponse, "companyId">>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    const session = toSession({ ...response, companyId: "" });
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
    return session;
  } catch (err) {
    if (err instanceof ApiError) {
      await clearSession();
      return null;
    }
    throw err;
  }
}

export async function logout(session: Session | null): Promise<void> {
  if (session) {
    await apiRequest("/auth/logout", { method: "POST", token: session.accessToken }).catch(() => undefined);
  }
  await clearSession();
}

async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    restoreSession()
      .then(setSession)
      .finally(() => setIsLoading(false));
  }, []);

  const doLogin = useCallback(async (input: LoginInput) => {
    const next = await login(input);
    setSession(next);
  }, []);

  const doLogout = useCallback(async () => {
    await logout(session);
    setSession(null);
  }, [session]);

  const value = useMemo(
    () => ({ session, isLoading, login: doLogin, logout: doLogout }),
    [session, isLoading, doLogin, doLogout],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
