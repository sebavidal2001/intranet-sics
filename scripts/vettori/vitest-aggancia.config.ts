import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Fuori dalla suite ordinaria: chiama un modello a pagamento.
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["scripts/vettori/aggancia-ai.test.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
