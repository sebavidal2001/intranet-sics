import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Configurazione dedicata: il caricamento fatture non deve mai finire nella
// suite ordinaria, perché scrive in archivio quando glielo si chiede.
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["scripts/vettori/carica-fatture.test.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
