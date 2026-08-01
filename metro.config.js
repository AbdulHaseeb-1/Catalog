// Learn more: https://docs.expo.dev/guides/customizing-metro/
// Web SQLite (wa-sqlite) needs .wasm as an asset + SharedArrayBuffer headers.
// https://docs.expo.dev/versions/latest/sdk/sqlite/#web-setup
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow Metro to resolve expo-sqlite's wa-sqlite.wasm
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), 'wasm'];

// SharedArrayBuffer requires COOP/COEP headers (dev server)
const previousEnhance = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const base = previousEnhance ? previousEnhance(middleware, server) : middleware;
    return (req, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      return base(req, res, next);
    };
  },
};

module.exports = config;
