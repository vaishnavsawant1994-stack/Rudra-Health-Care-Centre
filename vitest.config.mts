import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "scripts/**/*.test.mjs"],
    // API tests and PostgreSQL integration suites load the Next.js/Better Auth
    // dependency graph. Running them together caused request-boundary tests to
    // exceed the normal 5s test limit and DB cleanup to exceed its hook limit.
    // A single isolated worker keeps the default suite reliable without
    // disabling file isolation or excluding coverage.
    maxWorkers: 1,
    // Cold Next.js/Better Auth imports and disposable PostgreSQL cleanup can
    // exceed Vitest's defaults on Windows; allow completion without skipping
    // assertions or weakening the isolated database checks.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
