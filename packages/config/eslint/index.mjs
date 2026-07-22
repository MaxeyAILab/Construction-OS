// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

/**
 * Base ESLint flat config shared by all apps/packages.
 * Module-boundary rule (architecture.md §4.2): a module's `application/`,
 * `domain/`, `infrastructure/`, `api/` folders may only be deep-imported
 * from within that same module — everyone else imports the module's
 * `index.ts` public surface.
 */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Node-run CommonJS config files (metro.config.js, babel.config.js, ...).
    files: ["**/*.config.js", "**/*.config.cjs", "babel.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);

// CLAUDE.md: "Design tokens only: no raw hex/px values in components"
// (ui-design-system.md §2); §10's governance section calls this out by
// name as "hex-literal lint." Scoped to design-system consuming packages
// (packages/ui, apps/web) — hex-looking strings elsewhere (fixtures,
// secrets, non-UI code) aren't this rule's concern.
export const noRawHexColors = {
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
        message:
          "No raw hex colors in component code — use design tokens from @constructionos/ui (ui-design-system.md §2).",
      },
      {
        selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
        message:
          "No raw hex colors in component code — use design tokens from @constructionos/ui (ui-design-system.md §2).",
      },
    ],
  },
};

export const moduleBoundaries = {
  plugins: { import: importPlugin },
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          {
            target: "./src/modules/!(*/index.ts)",
            from: "./src/modules/*/{api,application,domain,infrastructure,events}/**",
            except: ["../../{api,application,domain,infrastructure,events}/**"],
            message:
              "Cross-module imports must go through the target module's index.ts public surface (architecture.md §4.2).",
          },
        ],
      },
    ],
  },
};

export default base;
