import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    hookTimeout: 60_000,
    coverage: { provider: "v8", reporter: ["text","html"], lines: 60, functions: 60 },
  },
});
