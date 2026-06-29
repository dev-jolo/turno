import path from "node:path";
import { defineConfig } from "vitest/config";

// Engine tests are pure TypeScript (no DOM), so no React plugin is needed here.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
