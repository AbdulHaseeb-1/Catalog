import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Explicit imports only (`#imports`) - keeps ESLint/TS happy without a
  // generated auto-imports config, and makes every WXT API usage greppable.
  imports: false,
  manifest: {
    name: "VerifyBridge",
    description: "Continue desktop identity verification using your phone.",
    permissions: ["storage", "activeTab", "notifications"],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
