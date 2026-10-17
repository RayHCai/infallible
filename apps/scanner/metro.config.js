// Expo's default config auto-detects the pnpm monorepo (watchFolders,
// nodeModulesPaths), so workspace packages like @infallible/contracts resolve.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
