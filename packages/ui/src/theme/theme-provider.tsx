"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "cos-theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

// ui-design-system.md §5.1: "system-follow default, manual override per
// user." Persists the explicit choice; "system" defers to the OS via the
// prefers-color-scheme media query in tokens.css rather than JS-computed
// colors, so it stays correct even if this provider hasn't mounted yet.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    const initial = stored ?? "system";
    setThemeState(initial);
    setResolvedTheme(initial === "system" ? (systemPrefersDark() ? "dark" : "light") : initial);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") {
      setResolvedTheme(theme);
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(media.matches ? "dark" : "light");
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

// Inline, pre-hydration script (rendered in <head> by the consuming app's
// root layout) that applies the stored theme synchronously — avoids a
// flash of the wrong theme between first paint and ThemeProvider mounting.
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t&&t!=="system"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;
