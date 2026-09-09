import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    // I worktree git sotto `.claude/` sono altri checkout del repo, fermi a un
    // commit diverso. I loro test venivano raccolti da questa suite ma
    // risolvevano `@/...` sui sorgenti del checkout principale: bastava
    // modificare un file condiviso per farli fallire, con un errore che parla
    // di codice che qui non esiste più.
    // I collaudi sotto `scripts/vettori/` hanno una configurazione loro
    // (`scripts/vettori/vitest*.config.ts`): girano in ambiente Node, non
    // jsdom, e interrogano il database vero o il riconoscimento ottico. Sono
    // strumenti di misura, non test di regressione: durano minuti, e raccolti
    // in questa suite la farebbero fallire per lentezza, non per un difetto.
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/worktrees/**",
      "scripts/vettori/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
