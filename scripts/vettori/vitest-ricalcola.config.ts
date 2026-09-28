import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Fuori dalla suite ordinaria: riscrive i controlli in archivio quando glielo
// si chiede.
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["scripts/vettori/ricalcola-controlli.test.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
