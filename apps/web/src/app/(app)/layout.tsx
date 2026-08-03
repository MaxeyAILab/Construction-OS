"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, ShieldCheck } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@constructionos/ui";
import { apiClient } from "@/lib/api-client";
import { clearSession, getAccessToken } from "@/lib/session";

const NAV_ITEMS: AppShellNavItem[] = [
  { label: "Projects", href: "/projects", icon: LayoutGrid },
  { label: "Roles & permissions", href: "/admin/roles", icon: ShieldCheck },
];

interface Me {
  fullName: string;
  companyName: string;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    apiClient.get<Me>("/auth/me").catch(() => undefined).then((data) => data && setMe(data));
  }, []);

  async function handleLogout() {
    try {
      await apiClient.post("/auth/logout");
    } catch {
      // Best-effort — the local session is cleared regardless.
    }
    clearSession();
    router.push("/login");
  }

  return (
    <AppShell
      navItems={NAV_ITEMS}
      activeHref={pathname}
      companyName={me?.companyName ?? ""}
      userName={me?.fullName ?? ""}
      onNavigate={router.push}
      onLogout={handleLogout}
    >
      {children}
    </AppShell>
  );
}
