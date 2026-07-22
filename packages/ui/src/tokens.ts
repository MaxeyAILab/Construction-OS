// Design tokens (ui-design-system.md §2) — the single source of truth.
// tokens.css mirrors these values as CSS custom properties (light/dark);
// Tailwind's theme (apps/web/tailwind.config.ts) maps onto those CSS vars.
// Components must consume tokens only — no raw hex/px in component code
// (CLAUDE.md, enforced by the no-raw-design-values ESLint rule).
//
// Any value changed here must be changed in tokens.css too — there's no
// build step generating one from the other yet (flagged as a v2 follow-up:
// a small script could derive tokens.css from this file directly).

export const neutralScale = {
  light: {
    0: "#FFFFFF",
    50: "#F7F7F6",
    100: "#F0F0EE",
    200: "#E4E4E1",
    300: "#CFCFCA",
    500: "#8A8A84",
    700: "#4A4A46",
    900: "#1C1C1A",
  },
  dark: {
    0: "#0E0F11",
    50: "#16181B",
    100: "#1D2024",
    200: "#26292E",
    300: "#33373D",
    500: "#7A7F87",
    700: "#B6BBC2",
    900: "#EDEFF2",
  },
} as const;

// Brand + semantic scales anchor exactly on ui-design-system.md's named
// 600-step values (brand-600 #2563EB, success-600 #16A34A, warning-600
// #D97706, danger-600 #DC2626, ai-600 #7C3AED) — each is a standard 50-900
// ramp built around that anchor.
export const brandScale = {
  50: "#EFF6FF",
  100: "#DBEAFE",
  200: "#BFDBFE",
  300: "#93C5FD",
  400: "#60A5FA",
  500: "#3B82F6",
  600: "#2563EB",
  700: "#1D4ED8",
  800: "#1E40AF",
  900: "#1E3A8A",
} as const;

export const successScale = {
  50: "#F0FDF4",
  100: "#DCFCE7",
  200: "#BBF7D0",
  300: "#86EFAC",
  400: "#4ADE80",
  500: "#22C55E",
  600: "#16A34A",
  700: "#15803D",
  800: "#166534",
  900: "#14532D",
} as const;

export const warningScale = {
  50: "#FFFBEB",
  100: "#FEF3C7",
  200: "#FDE68A",
  300: "#FCD34D",
  400: "#FBBF24",
  500: "#F59E0B",
  600: "#D97706",
  700: "#B45309",
  800: "#92400E",
  900: "#78350F",
} as const;

export const dangerScale = {
  50: "#FEF2F2",
  100: "#FEE2E2",
  200: "#FECACA",
  300: "#FCA5A5",
  400: "#F87171",
  500: "#EF4444",
  600: "#DC2626",
  700: "#B91C1C",
  800: "#991B1B",
  900: "#7F1D1D",
} as const;

// "Info / AI" — reserved exclusively for AI-generated content (FR-AI-4).
export const aiScale = {
  50: "#F5F3FF",
  100: "#EDE9FE",
  200: "#DDD6FE",
  300: "#C4B5FD",
  400: "#A78BFA",
  500: "#8B5CF6",
  600: "#7C3AED",
  700: "#6D28D9",
  800: "#5B21B6",
  900: "#4C1D95",
} as const;

// 8-step categorical set for charts; sequential = brand ramp, diverging =
// danger<->neutral<->success for budget variance (dataviz conventions).
export const dataVizPalette = [
  "#2563EB", // brand
  "#0EA5E9", // sky
  "#16A34A", // success
  "#D97706", // warning
  "#DC2626", // danger
  "#7C3AED", // ai
  "#DB2777", // pink
  "#64748B", // slate
] as const;

export const typography = {
  fontSans: "InterVariable, Inter, sans-serif",
  fontDisplay: "'Inter Display', InterVariable, Inter, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
  scale: {
    xs: { size: "12px", lineHeight: "16px" },
    sm: { size: "13px", lineHeight: "20px" },
    base: { size: "14px", lineHeight: "22px" },
    md: { size: "16px", lineHeight: "24px" },
    lg: { size: "18px", lineHeight: "26px" },
    xl: { size: "22px", lineHeight: "30px" },
    "2xl": { size: "28px", lineHeight: "36px" },
    "3xl": { size: "34px", lineHeight: "42px" },
  },
  weight: {
    body: 400,
    label: 500,
    heading: 600,
  },
} as const;

// 4-pt grid: space-N = N * 4px.
export const spacing = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  full: "9999px",
} as const;

export const elevation = {
  0: "none", // flat + hairline border — the default (Linear-style)
  1: "0 1px 2px rgb(0 0 0 / 0.05)",
  2: "0 4px 12px rgb(0 0 0 / 0.08)",
  3: "0 12px 32px rgb(0 0 0 / 0.14)",
} as const;

export const motion = {
  duration: {
    fast: "120ms",
    base: "150ms",
    slow: "240ms",
  },
  // The house curve, "swift-out".
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

// StatusChip's single source of semantic status color (ui-design-system.md
// §7: "never ad-hoc colored text").
export const statusTone = {
  neutral: "neutral",
  success: "success",
  warning: "warning",
  danger: "danger",
  ai: "ai",
} as const;
export type StatusTone = keyof typeof statusTone;
