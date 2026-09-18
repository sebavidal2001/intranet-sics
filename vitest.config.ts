import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Gli otto file che leggono dal database vero.
 *
 * Ognuno costruisce uno snapshot scaricando ~66.000 righe via PostgREST. In
 * parallelo si mettono in coda a vicenda e sforano il timeout: `npx vitest run
 * prototipo-bi` dava OTTO suite fallite, e lo stesso comando con
 * `--no-file-parallelism` ne dava zero su 401 test. Il fallimento era stato
 * attribuito due volte — da Codex e da me — alla mancanza di connessione al
 * database. Non lo era.
 *
 * Un rosso ambientale ricorrente e' peggio di un test mancante: insegna a
 * ignorare il rosso.
 */
const LEGGONO_DAL_DATABASE = [
  "prototipo-bi/_perf.test.ts",
  "prototipo-bi/analista.test.tsx",
  "prototipo-bi/business-unit.test.ts",
  "prototipo-bi/costo-storico-dal-database.test.ts",
  "prototipo-bi/cruscotto-margine.test.ts",
  "prototipo-bi/margine-riconciliazione.test.ts",
  "prototipo-bi/documenti.test.ts",
  "prototipo-bi/eta-dettaglio.test.ts",
  "prototipo-bi/integrazione.test.ts",
  "prototipo-bi/preventivi-backoffice.test.ts",
  "prototipo-bi/verifica.test.ts",
];

const ESCLUSI = [
  ...configDefaults.exclude,
  // I worktree git sotto `.claude/` sono altri checkout del repo, fermi a un
  // commit diverso. I loro test venivano raccolti da questa suite ma
  // risolvevano `@/...` sui sorgenti del checkout principale: bastava
  // modificare un file condiviso per farli fallire, con un errore che parla
  // di codice che qui non esiste più.
  "**/.claude/worktrees/**",
  // I collaudi sotto `scripts/vettori/` hanno una configurazione loro
  // (`scripts/vettori/vitest*.config.ts`): girano in ambiente Node, non
  // jsdom, e interrogano il database vero o il riconoscimento ottico. Sono
  // strumenti di misura, non test di regressione: durano minuti, e raccolti
  // in questa suite la farebbero fallire per lentezza, non per un difetto.
  "scripts/vettori/**",
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    exclude: ESCLUSI,
    projects: [
      {
        plugins: [react()],
        test: {
          name: "unita",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/tests/setup.ts"],
          exclude: [...ESCLUSI, ...LEGGONO_DAL_DATABASE],
        },
        resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
      },
      {
        plugins: [react()],
        test: {
          name: "database",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/tests/setup.ts"],
          include: LEGGONO_DAL_DATABASE,
          exclude: ESCLUSI,
          // In fila indiana, e con il respiro giusto: la prima connessione dopo
          // una pausa o una VPN riagganciata e' lenta, e il default di 5s la
          // fa fallire senza che niente sia rotto.
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 300_000,
        },
        resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
