import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Tests share one isolated PostgreSQL instance and truncate between tests.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: "test" },
  },
});
