"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorState, Field, Input } from "@constructionos/ui";
import { apiClient, ApiError } from "../../lib/api-client";
import { saveSession } from "../../lib/session";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await apiClient.post<LoginResponse>("/auth/login", { email, password });
      saveSession(session.accessToken, session.refreshToken);
      router.push("/admin/roles");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Card padding="lg" className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold text-neutral-900">Sign in</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Email">
            {({ inputId }) => (
              <Input
                id={inputId}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password">
            {({ inputId }) => (
              <Input
                id={inputId}
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {error && <ErrorState variant="inline" message={error} />}
          <Button type="submit" loading={submitting}>
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}
