import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Each test starts a fresh in-memory Postgres; allow for slow CI machines.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
