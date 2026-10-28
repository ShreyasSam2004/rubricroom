import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    env: {
      PGLITE_MEMORY: "1",
      AI_PROVIDER: "none",
      SEARCH_PROVIDER: "none",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      TAVILY_API_KEY: "",
      EXA_API_KEY: "",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    // Each integration file runs its own embedded Postgres; more parallel forks than this starves
    // them on a laptop and the slowest tests time out.
    maxWorkers: 4,
  },
});
