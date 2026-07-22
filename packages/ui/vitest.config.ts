import { defineConfig } from "vitest/config";

export default defineConfig({
  // packages/ui's tsconfig sets jsx:"preserve" (Next.js compiles JSX
  // itself); Vite/esbuild needs an explicit mode here or it falls back to
  // the classic transform, which needs `React` in scope.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
