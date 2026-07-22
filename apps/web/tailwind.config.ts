import type { Config } from "tailwindcss";
import uiPreset from "@constructionos/ui/tailwind-preset";

export default {
  presets: [uiPreset as Partial<Config>],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
