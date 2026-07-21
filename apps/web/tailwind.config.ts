import type { Config } from "tailwindcss";

// Design tokens (ui-design-system.md §2) land with the design-system-v1
// workstream; this config extends as those tokens are defined.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
