import { base, noRawHexColors } from "@constructionos/config/eslint";

export default [
  ...base,
  {
    ...noRawHexColors,
    // tokens.ts IS the hex source of truth (mirrored into tokens.css) —
    // every other file must consume it, not redefine colors inline.
    ignores: ["src/tokens.ts"],
  },
  { ignores: ["dist/**"] },
];
