import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: { environment: "node", include: ["scripts/vettori/carica-con-modello.test.ts"], testTimeout: 1_800_000 },
});
