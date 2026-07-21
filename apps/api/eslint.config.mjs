import { base, moduleBoundaries } from "@constructionos/config/eslint";

export default [...base, moduleBoundaries, { ignores: ["dist/**"] }];
