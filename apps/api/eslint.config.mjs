import { base, moduleBoundaries } from "@constructionos/config/eslint";

export default [
  ...base,
  moduleBoundaries,
  {
    // NestJS constructor injection resolves providers via
    // emitDecoratorMetadata, which needs the real class reference at
    // runtime — this rule's autofix can't tell that from a type-only
    // usage and will silently break DI by rewriting the import to
    // `import type`. Not worth the risk in a DI-heavy app.
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  { ignores: ["dist/**"] },
];
