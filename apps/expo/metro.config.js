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

// Note: disableHierarchicalLookup is NOT set — Expo defaults to false and we keep it that way.

module.exports = config;
