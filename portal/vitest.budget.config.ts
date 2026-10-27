import { defineConfig } from "vitest/config";

// bd-sex15q.34 — the bundle budgets. They build the portal, so they run on their own (`npm run test:budget`),
// never inside the default `vitest run`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["budget/**/*.budget.test.ts"],
    testTimeout: 60_000,
  },
});
