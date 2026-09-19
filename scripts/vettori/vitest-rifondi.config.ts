import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Come la configurazione del caricamento fatture: fuori dalla suite ordinaria,
// perché scrive nel livello operativo quando glielo si chiede.
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["scripts/vettori/rifondi-bolle.test.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
