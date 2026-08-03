"use client";

import { ChevronLeft, ChevronRight, LogOut, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { Avatar, AvatarFallback } from "./avatar";
import { Button } from "./button";
import { ThemeToggle } from "./theme-toggle";

export interface AppShellNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface AppShellProps {
  navItems: AppShellNavItem[];
  /** Current pathname, used to highlight the active nav item (exact or prefix match). */
  activeHref: string;
  companyName: string;
  userName: string;
  onNavigate: (href: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

// ui-design-system.md §3.6: fixed left sidebar (company + module nav,
// collapsible to an icon rail) + topbar (theme toggle, avatar). The
// documented breadcrumb/command-palette/notifications-bell/AI-assistant-
// button topbar affordances aren't built yet (no entity-path context or
// notifications feed is wired into the web app) — left out rather than
// faked; add them here once those features exist.
export function AppShell({
  navItems,
  activeHref,
  companyName,
  userName,
  onNavigate,
  onLogout,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 transition-[width] duration-base ease-out",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className={cn("flex h-14 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-brand text-sm font-semibold text-white">
            C
          </span>
          {!collapsed && <span className="truncate text-sm font-semibold text-neutral-900">ConstructionOS</span>}
        </div>

        {!collapsed && (
          <div className="px-4 pb-2 text-xs text-neutral-500">
            <span className="truncate">{companyName}</span>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
          {navItems.map((item) => {
            const active = activeHref === item.href || activeHref.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => onNavigate(item.href)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast ease-out",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-brand-50 text-brand"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-500 transition-colors duration-fast ease-out hover:bg-neutral-100 hover:text-neutral-900",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-neutral-200 bg-neutral-0 px-6">
          <ThemeToggle />
          <div className="flex items-center gap-2">
            <Avatar className="size-8">
              <AvatarFallback>{initials(userName)}</AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-neutral-900 md:inline">{userName}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Log out">
            <LogOut className="size-4" />
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
