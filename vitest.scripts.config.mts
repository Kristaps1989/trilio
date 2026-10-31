import { defineConfig } from "vitest/config";
import path from "node:path";

// Generators that write files (npm run creatives:meta); not part of the test suite.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["scripts/**/*.gen.{ts,tsx}"], environment: "node", testTimeout: 600_000 },
});
