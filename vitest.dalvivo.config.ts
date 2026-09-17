/**
 * Configurazione per i banchi di prova DAL VIVO.
 *
 * I file `prototipo-bi/*-dal-vivo.ts` chiamano davvero OpenRouter e spendono
 * davvero: per questo non finiscono nella suite automatica, dove girerebbero a
 * ogni `npm test`. L'estensione `.ts` invece di `.test.ts` li tiene fuori.
 *
 * Il guaio e' che li teneva fuori anche quando li si lanciava a mano: l'`include`
 * predefinito di vitest e' `**\/*.{test,spec}.?(c|m)[jt]s?(x)`, quindi il comando
 * documentato in testa a `manuale-analista-dal-vivo.ts` rispondeva
 * «No test files found» e nessuno se n'era accorto. Questa configurazione li
 * include per nome.
 *
 *   npx vitest run --config vitest.dalvivo.config.ts --testTimeout=900000
 *   npx vitest run --config vitest.dalvivo.config.ts prototipo-bi/confronto-modelli-dal-vivo.ts
 *
 * Ambiente `node` e non `jsdom`: qui non si disegna niente, si chiamano API.
 * Sequenziale: sono chiamate a pagamento, e in parallelo i costi si mescolano
 * e le misure di durata non vogliono dire piu' niente.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["prototipo-bi/*-dal-vivo.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
