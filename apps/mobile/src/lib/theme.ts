// Mirrors the dark-mode subset of packages/ui/src/tokens.ts (ui-design-
// system.md §2) needed by the mobile shell. Not a shared import: that
// package's "." export resolves to Radix/react-dom component code with no
// React Native build target, so pulling it into the Metro bundle would
// break — this file exists so RN screens still consume named tokens
// rather than scattering raw hex, pending a real cross-platform token
// package split (flagged as a follow-up, not done here).
//
// roadmap.md Phase 1C "Field UX hardening: high-contrast, 52 px targets,
// voice notes" adds a second, high-contrast variant plus a persisted
// per-device toggle (More tab) — outdoor/bright-sunlight readability for
// field crews, same intent as an OS-level "increase contrast" setting.
// Mirrors src/lib/auth.ts's context pattern (createElement, no JSX, since
// this is a .ts file) rather than introducing a second provider shape.
import * as SecureStore from "expo-secure-store";
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const HIGH_CONTRAST_KEY = "cos.highContrastMode";

export interface Theme {
  colors: {
    background: string;
    surface: string;
    surfaceRaised: string;
    border: string;
    text: string;
    textMuted: string;
    brand: string;
    success: string;
    warning: string;
    danger: string;
  };
  spacing: { 1: number; 2: number; 3: number; 4: number; 5: number; 6: number; 8: number };
  radius: { sm: number; md: number; lg: number };
  borderWidth: number;
  minTouchTarget: number;
}

export const standardTheme: Theme = {
  colors: {
    background: "#0E0F11",
    surface: "#16181B",
    surfaceRaised: "#1D2024",
    border: "#26292E",
    text: "#EDEFF2",
    textMuted: "#B6BBC2",
    brand: "#2563EB",
    success: "#16A34A",
    warning: "#D97706",
    danger: "#DC2626",
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
  },
  borderWidth: 1,
  minTouchTarget: 52,
};

// Pure black/white + wider borders and more saturated status colors —
// targets WCAG AAA (7:1) body-text contrast rather than the standard
// theme's AA-range grays, for outdoor/bright-sunlight field use.
export const highContrastTheme: Theme = {
  colors: {
    background: "#000000",
    surface: "#000000",
    surfaceRaised: "#1A1A1A",
    border: "#FFFFFF",
    text: "#FFFFFF",
    textMuted: "#E0E0E0",
    brand: "#4DA3FF",
    success: "#3DDC5B",
    warning: "#FFB300",
    danger: "#FF5252",
  },
  spacing: standardTheme.spacing,
  radius: standardTheme.radius,
  borderWidth: 2,
  minTouchTarget: 52,
};

// Kept as a plain export for any non-component module that needs a
// default (there are none left after the ThemeProvider migration, but
// removing it would be a needless breaking change for no benefit).
export const theme: Theme = standardTheme;

interface ThemeContextValue {
  theme: Theme;
  isHighContrast: boolean;
  setHighContrast: (value: boolean) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isHighContrast, setIsHighContrast] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(HIGH_CONTRAST_KEY).then((value) => {
      if (value === "1") setIsHighContrast(true);
    });
  }, []);

  const setHighContrast = async (value: boolean) => {
    setIsHighContrast(value);
    await SecureStore.setItemAsync(HIGH_CONTRAST_KEY, value ? "1" : "0");
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: isHighContrast ? highContrastTheme : standardTheme, isHighContrast, setHighContrast }),
    [isHighContrast],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
