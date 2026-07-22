"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Checkbox,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from "@constructionos/ui";
import { apiClient, ApiError } from "../../../lib/api-client";
import { getAccessToken } from "../../../lib/session";

interface Role {
  id: string;
  name: string;
  permissions: string[];
}

interface Permission {
  key: string;
  module: string;
  resource: string;
  action: string;
  description: string | null;
}

export default function RolesAdminPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [newRoleName, setNewRoleName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const [roleList, permissionCatalog] = await Promise.all([
      apiClient.get<Role[]>("/rbac/roles"),
      apiClient.get<Permission[]>("/rbac/permissions"),
    ]);
    setRoles(roleList);
    setCatalog(permissionCatalog);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    reload()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    try {
      await apiClient.post("/rbac/roles", { name: newRoleName });
      setNewRoleName("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create role");
    }
  }

  async function togglePermission(role: Role, permissionKey: string, granted: boolean) {
    try {
      if (granted) {
        await apiClient.delete(`/rbac/roles/${role.id}/permissions/${permissionKey}`);
      } else {
        await apiClient.post(`/rbac/roles/${role.id}/permissions`, { permissionKey });
      }
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update permission");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Roles &amp; Permissions</h1>
      {error && <ErrorState variant="inline" message={error} />}

      <form onSubmit={createRole} className="flex items-end gap-2">
        <Field label="New role name" className="flex-1">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit">Create role</Button>
      </form>

      <div className="flex flex-col gap-4">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle>{role.name}</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {catalog.map((permission) => {
                const granted = role.permissions.includes(permission.key);
                return (
                  <li key={permission.key} className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={granted}
                        onCheckedChange={() => togglePermission(role, permission.key, granted)}
                        aria-label={permission.key}
                      />
                      <span className="font-mono text-neutral-900">{permission.key}</span>
                    </label>
                    {permission.description && (
                      <span className="text-neutral-500">— {permission.description}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </main>
  );
}
