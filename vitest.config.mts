import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/i18n/format.ts", "src/services/**"],
      // Entry points and the Anthropic SDK wrapper need a scheduler, a network or a
      // real API key; they are exercised by the CLI dry-runs and e2e, not unit tests.
      exclude: [
        "**/cli.ts",
        "src/services/ingestion/run.ts",
        "src/services/llm/client.ts",
        "src/services/llm/extract-job.ts",
        "src/services/billing/job.ts",
      ],
      thresholds: { branches: 80, lines: 85 },
    },
  },
});
