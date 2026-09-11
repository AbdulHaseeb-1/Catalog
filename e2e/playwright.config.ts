import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm run start:prod",
      cwd: path.join(repoRoot, "apps/api"),
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      command: "pnpm run preview",
      cwd: path.join(repoRoot, "apps/mobile"),
      url: "http://localhost:5174",
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      command: "pnpm run preview",
      cwd: path.join(repoRoot, "apps/demo-site"),
      url: "http://localhost:5175",
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
});
