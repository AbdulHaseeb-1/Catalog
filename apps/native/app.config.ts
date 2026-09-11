import type { ConfigContext, ExpoConfig } from "expo/config";

// The host Android App Links / iOS Universal Links verify against - this
// must be the same host as PUBLIC_MOBILE_URL / apps/mobile's deployment,
// since the mobile web URL is the one thing every path (QR scan, shared
// link, browser fallback) always has in common. Override for production.
const MOBILE_HOST = process.env.EXPO_PUBLIC_MOBILE_HOST ?? "verify.example.com";
const BUNDLE_ID = "com.verifybridge.app";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "VerifyBridge",
  slug: "verifybridge",
  scheme: "verifybridge",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  experiments: {
    typedRoutes: true,
  },
  ios: {
    ...config.ios,
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    // Universal Links: requires public/.well-known/apple-app-site-association
    // to be served over HTTPS from MOBILE_HOST with the real Apple Team ID -
    // see README's "Deep linking" section.
    associatedDomains: [`applinks:${MOBILE_HOST}`],
  },
  android: {
    ...config.android,
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // App Links: requires public/.well-known/assetlinks.json to be served
    // over HTTPS from MOBILE_HOST with the real signing cert fingerprint -
    // see README's "Deep linking" section.
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: MOBILE_HOST, pathPrefix: "/session" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    ...config.web,
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },
  plugins: [
    "expo-router",
    [
      "expo-camera",
      {
        cameraPermission:
          "VerifyBridge uses your camera to complete the identity verification you started on your computer.",
        recordAudioAndroid: false,
      },
    ],
    "expo-build-properties",
  ],
  extra: {
    ...config.extra,
    mobileHost: MOBILE_HOST,
  },
});
