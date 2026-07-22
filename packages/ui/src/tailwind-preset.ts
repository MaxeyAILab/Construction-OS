import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

// Shared Tailwind preset (ui-design-system.md §2.5) — every consuming app
// (apps/web today; any future Tailwind-based surface) extends this preset
// rather than redefining the token mapping, so "one system, three
// postures" (§1.6) doesn't drift between apps. Values reference the CSS
// custom properties in tokens.css, not raw hex/px, so light/dark/
// high-contrast resolve automatically without a second Tailwind build.
const preset = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [],
  theme: {
    extend: {
      colors: {
        neutral: {
          0: "var(--color-neutral-0)",
          50: "var(--color-neutral-50)",
          100: "var(--color-neutral-100)",
          200: "var(--color-neutral-200)",
          300: "var(--color-neutral-300)",
          500: "var(--color-neutral-500)",
          700: "var(--color-neutral-700)",
          900: "var(--color-neutral-900)",
        },
        brand: {
          50: "var(--color-brand-50)",
          100: "var(--color-brand-100)",
          200: "var(--color-brand-200)",
          300: "var(--color-brand-300)",
          400: "var(--color-brand-400)",
          500: "var(--color-brand-500)",
          600: "var(--color-brand-600)",
          700: "var(--color-brand-700)",
          800: "var(--color-brand-800)",
          900: "var(--color-brand-900)",
          DEFAULT: "var(--color-brand-solid)",
        },
        success: {
          50: "var(--color-success-50)",
          600: "var(--color-success-600)",
          700: "var(--color-success-700)",
        },
        warning: {
          50: "var(--color-warning-50)",
          600: "var(--color-warning-600)",
          700: "var(--color-warning-700)",
        },
        danger: {
          50: "var(--color-danger-50)",
          600: "var(--color-danger-600)",
          700: "var(--color-danger-700)",
        },
        ai: {
          50: "var(--color-ai-50)",
          600: "var(--color-ai-600)",
          700: "var(--color-ai-700)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        md: ["16px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "26px" }],
        xl: ["22px", { lineHeight: "30px" }],
        "2xl": ["28px", { lineHeight: "36px" }],
        "3xl": ["34px", { lineHeight: "42px" }],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        "elev-1": "var(--elevation-1)",
        "elev-2": "var(--elevation-2)",
        "elev-3": "var(--elevation-3)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        out: "var(--easing-swift-out)",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
      },
      keyframes: {
        shimmer: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        shimmer: "shimmer 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Partial<Config>;

export default preset;
