import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["scripts/vettori/ocr/*.test.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
});
