import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Fuori dalla suite ordinaria, come le altre utilità di caricamento: scrive in
// archivio quando glielo si chiede.
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["scripts/vettori/carica-fattura-trascritta.test.ts"],
    testTimeout: 600_000,
  },
});
