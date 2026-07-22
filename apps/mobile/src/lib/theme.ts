// Mirrors the dark-mode subset of packages/ui/src/tokens.ts (ui-design-
// system.md §2) needed by the mobile shell. Not a shared import: that
// package's "." export resolves to Radix/react-dom component code with no
// React Native build target, so pulling it into the Metro bundle would
// break — this file exists so RN screens still consume named tokens
// rather than scattering raw hex, pending a real cross-platform token
// package split (flagged as a follow-up, not done here).
export const theme = {
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
} as const;
