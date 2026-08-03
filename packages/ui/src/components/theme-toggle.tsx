"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../theme/theme-provider";
import { cn } from "../lib/cn";

// ui-design-system.md §5.1: "system-follow default, manual override per
// user" — a 3-way segmented control over ThemeProvider's own preference,
// not a 2-way light/dark switch, so "system" stays a first-class choice.
const OPTIONS: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light theme" },
  { value: "dark", icon: Moon, label: "Dark theme" },
  { value: "system", icon: Monitor, label: "Match system theme" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn("inline-flex items-center gap-0.5 rounded-md border border-neutral-200 bg-neutral-50 p-0.5", className)}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-sm transition-colors duration-fast ease-out",
            theme === value
              ? "bg-neutral-0 text-brand shadow-elev-1"
              : "text-neutral-500 hover:text-neutral-900",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
