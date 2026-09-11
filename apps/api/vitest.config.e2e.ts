import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/e2e/**/*.e2e-spec.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // e2e specs share one real Postgres/Redis and mutate the same tables -
    // run them one file at a time to avoid cross-test interference.
    fileParallelism: false,
  },
});
