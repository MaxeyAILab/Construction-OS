const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

// pnpm keeps each package's real files under node_modules/.pnpm and symlinks
// them into place, so Metro needs symlink-aware resolution plus visibility
// into the workspace root to see sibling packages (docs.expo.dev/guides/monorepos).
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
