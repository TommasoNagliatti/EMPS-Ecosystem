const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// tslib's Node import wrapper has no default export in Metro's ESM graph.
// Resolve the helpers directly; keep Expo's resolver for every other module.
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(context, moduleName === 'tslib' ? 'tslib/tslib.es6.js' : moduleName, platform);

module.exports = config;
