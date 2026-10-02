const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo — add workspace root on top of Expo defaults
config.watchFolders = [
  ...config.watchFolders ?? [],
  workspaceRoot,
];

// 2. Tell Metro where to look for packages (local node_modules first, then root)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Web tools use React 19 at the workspace root; Expo SDK 52 requires React 18.
// Resolve every native React import from the app so the renderer and components
// share one instance, including imports originating in hoisted dependencies.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Note: disableHierarchicalLookup is NOT set — Expo defaults to false and we keep it that way.

module.exports = config;
