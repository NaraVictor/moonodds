import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests only, and deliberately so.
 *
 * Everything under test here is pure: grading, pricing, prompt rendering,
 * output validation. Those are the functions where a wrong answer is silent
 * and expensive, and they need no database, no network and no React. The
 * data layer has its own suite in scripts/verify-security.mjs, which runs
 * against a real database as a real client and proves things a mock cannot.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
