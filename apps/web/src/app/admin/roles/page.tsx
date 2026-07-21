"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
      .catch((err) => setError(err instanceof ApiError ? err.message : "failed to load"))
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
      setError(err instanceof ApiError ? err.message : "failed to create role");
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
      setError(err instanceof ApiError ? err.message : "failed to update permission");
    }
  }

  if (loading) return <main className="p-6">Loading...</main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Roles &amp; Permissions</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <form onSubmit={createRole} className="mb-6 flex gap-2">
        <input
          placeholder="New role name"
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded bg-blue-600 px-3 py-2 text-white">
          Create role
        </button>
      </form>

      <div className="flex flex-col gap-6">
        {roles.map((role) => (
          <section key={role.id} className="rounded border border-gray-200 p-4">
            <h2 className="mb-2 font-medium">{role.name}</h2>
            <ul className="flex flex-col gap-1">
              {catalog.map((permission) => {
                const granted = role.permissions.includes(permission.key);
                return (
                  <li key={permission.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={granted}
                      onChange={() => togglePermission(role, permission.key, granted)}
                    />
                    <span>{permission.key}</span>
                    {permission.description && (
                      <span className="text-gray-500">— {permission.description}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
