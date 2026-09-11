import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "VerifyBridge",
        short_name: "VerifyBridge",
        description: "Continue your desktop identity verification using your phone.",
        theme_color: "#2563eb",
        background_color: "#f7f7f8",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The verification flow must always hit the network for a fresh
        // session status - never serve a stale cached API response.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { port: 5174 },
  preview: { port: 5174 },
});
