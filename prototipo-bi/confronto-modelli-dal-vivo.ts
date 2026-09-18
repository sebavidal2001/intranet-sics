/**
 * CONFRONTO FRA MODELLI — chiama davvero OpenRouter e spende davvero.
 *
 * NON fa parte della suite automatica: l'estensione è `.ts` e non `.test.ts`.
 * Si lancia a mano:
 *
 *   npx vitest run --config vitest.config.ts prototipo-bi/confronto-modelli-dal-vivo.ts --testTimeout=900000
 *
 * A cosa serve. Sul listino OpenRouter del 17/09/2026 `anthropic/claude-sonnet-5`
 * e `openai/gpt-5.6-sol` costano IDENTICO (2,00 in ingresso, 10,00 in uscita per
 * milione), quindi fra i due il prezzo non decide niente: decide se il modello
 * rispetta la disciplina che il prompt pretende. Quella non si legge in un
 * listino, si misura.
 *
 * Il segnale più importante non è il costo, è `nonVerificati`: quante cifre il
 * modello ha scritto nella risposta SENZA che risultino dagli strumenti che ha
 * chiamato. È la misura del "fa i conti a mente", che è il difetto che questo
 * intero impianto esiste per impedire.
 *
 * Tutti i modelli vengono messi al livello `analitica` (8 passi) sulle stesse
 * domande, così il confronto è a parità di condizioni.
 */
import { describe, it, beforeAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { chiediAnalista } from "@/lib/prototipo-bi/analista";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { MODELLI } from "@/lib/prototipo-bi/modelli";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";

const CANDIDATI = [
  { id: "anthropic/claude-haiku-4.5", nome: "Haiku 4.5", ingresso: 1.0, uscita: 5.0 },
  { id: "anthropic/claude-sonnet-5", nome: "Sonnet 5", ingresso: 2.0, uscita: 10.0 },
  { id: "openai/gpt-5.6-luna", nome: "gpt-5.6-luna", ingresso: 0.2, uscita: 1.2 },
  { id: "openai/gpt-5.6-sol", nome: "gpt-5.6-sol", ingresso: 2.0, uscita: 10.0 },
];

const DOMANDE = [
  {
    // Lettura diretta: deve chiamare uno strumento, non rispondere a memoria.
    etichetta: "lettura",
    testo: "Quanto abbiamo fatturato nel 2026 finora?",
  },
  {
    // La trappola del periodo: l'anno in corso contro l'anno intero mostra un
    // calo che è solo il tempo che manca. Il prompt lo vieta esplicitamente.
    etichetta: "confronto",
    testo: "Come sta andando il 2026 rispetto al 2025?",
  },
  {
    // Nome proprio scritto come lo direbbe una persona: senza `elenca_valori`
    // il filtro non aggancia niente e il vuoto sembra "non ha comprato".
    etichetta: "nome-proprio",
    testo: "Quanto ha comprato tecna quest'anno?",
  },
  {
    // Richiede SQL con percentile_cont: prima della correzione del guardiano
    // questa domanda non era esprimibile.
    etichetta: "sql-mediana",
    testo:
      "Qual è il valore mediano di riga d'ordine per business unit nel 2026? " +
      "Usa SQL se serve.",
  },
];

interface Esito {
  modello: string;
  domanda: string;
  ok: boolean;
  errore?: string;
  costoUsd: number;
  tokenIn: number;
  tokenOut: number;
  interrogazioni: number;
  /**
   * Query SQL davvero eseguite.
   *
   * `interrogazioni` conta solo le chiamate a `interroga_metrica`: nel primo
   * giro la domanda sulla mediana risultava «0 interrogazioni» sia per Haiku
   * sia per Sonnet, e da quel numero non si capiva se avessero usato SQL o lo
   * avessero evitato. I passi lo sapevano gia' (`tipo: "sql"` con il campo
   * `sql` valorizzato solo quando la query gira davvero, non quando si
   * consulta lo schema): era il banco a non guardarli.
   */
  sqlEseguiti: number;
  /** Consultazioni dello schema SQL senza poi eseguire niente. */
  schemaConsultato: number;
  /** Elenchi di valori chiesti: dice se ha usato `elenca_valori` sui nomi propri. */
  valoriElencati: number;
  passiErrore: number;
  nonVerificati: number;
  corretto: boolean;
  interpretazione: boolean;
  secondi: number;
  /** `true` se il costo viene da `usage.cost`, non dalla nostra moltiplicazione. */
  costoReale: boolean;
  primaRiga: string;
}

const esiti: Esito[] = [];

describe("Confronto modelli dal vivo", () => {
  let snapshot: Snapshot;

  beforeAll(async () => {
    caricaEnvLocale();
    snapshot = await costruisciSnapshot();
    console.log(
      `\nSnapshot: ${snapshot.dataMinima} → ${snapshot.dataMassima}, run ${snapshot.runCorrente}\n`
    );
  }, 300_000);

  for (const c of CANDIDATI) {
    it(
      `${c.nome}`,
      async () => {
        // `MODELLI` è mutabile (lo muta già `aggiornaPrezzi`): si sostituisce il
        // livello standard e si forza `analitica`, così ogni candidato riceve
        // esattamente lo stesso trattamento.
        const originale = { ...MODELLI.standard };
        Object.assign(MODELLI.standard, c, { note: "candidato in prova" });

        try {
          for (const d of DOMANDE) {
            const avvio = Date.now();
            try {
              const r = await chiediAnalista({
                domanda: d.testo,
                snapshot,
                complessita: "analitica",
                sqlLibero: true,
              });
              esiti.push({
                modello: c.nome,
                domanda: d.etichetta,
                ok: true,
                costoUsd: r.consumo?.costoUsd ?? 0,
                tokenIn: r.consumo?.tokenIngresso ?? 0,
                tokenOut: r.consumo?.tokenUscita ?? 0,
                interrogazioni: r.interrogazioni.length,
                sqlEseguiti: r.passi.filter((p) => p.tipo === "sql" && Boolean(p.sql)).length,
                schemaConsultato: r.passi.filter((p) => p.tipo === "sql" && !p.sql).length,
                valoriElencati: r.passi.filter((p) =>
                  p.descrizione.startsWith("valori di ")
                ).length,
                passiErrore: r.passi.filter((p) => p.tipo === "errore").length,
                nonVerificati: r.verifica?.nonVerificati ?? 0,
                corretto: r.correzioneApplicata,
                interpretazione: Boolean(r.interpretazione),
                secondi: Math.round((Date.now() - avvio) / 100) / 10,
                costoReale: r.consumo?.costoDichiarato === true,
                primaRiga: (r.interpretazione ?? r.testo).split("\n")[0].slice(0, 110),
              });
            } catch (e) {
              esiti.push({
                modello: c.nome,
                domanda: d.etichetta,
                ok: false,
                errore: e instanceof Error ? e.message.slice(0, 160) : String(e),
                costoUsd: 0,
                tokenIn: 0,
                tokenOut: 0,
                interrogazioni: 0,
                sqlEseguiti: 0,
                schemaConsultato: 0,
                valoriElencati: 0,
                passiErrore: 0,
                nonVerificati: 0,
                corretto: false,
                interpretazione: false,
                secondi: Math.round((Date.now() - avvio) / 100) / 10,
                costoReale: false,
                primaRiga: "",
              });
            }
          }
        } finally {
          Object.assign(MODELLI.standard, originale);
        }

        // Riepilogo per candidato, stampato subito: se il giro successivo si
        // pianta, quello che è stato misurato non si perde.
        const miei = esiti.filter((e) => e.modello === c.nome);
        console.log(`\n── ${c.nome} ─────────────────────────────`);
        for (const e of miei) {
          if (!e.ok) {
            console.log(`   ${e.domanda.padEnd(13)} ERRORE: ${e.errore}`);
            continue;
          }
          console.log(
            `   ${e.domanda.padEnd(13)} ${String(e.interrogazioni).padStart(2)} interr. · ` +
              `${e.sqlEseguiti} sql · ${e.valoriElencati} elenchi · ` +
              `${String(e.nonVerificati).padStart(2)} cifre non verificate · ` +
              `${e.passiErrore} errori · ${e.secondi}s · ` +
              `${(e.costoUsd * 100).toFixed(2)} cent · ` +
              `${e.tokenIn}/${e.tokenOut} token` +
              `${e.interpretazione ? "" : " · SENZA INTERPRETAZIONE"}` +
              `${e.corretto ? " · CORRETTO D'UFFICIO" : ""}`
          );
          console.log(`                 « ${e.primaRiga} »`);
        }
      },
      900_000
    );
  }

  it("riepilogo", () => {
    console.log("\n\n╔══ CONFRONTO ════════════════════════════════════════════════\n");
    const perModello = new Map<string, Esito[]>();
    for (const e of esiti) {
      perModello.set(e.modello, [...(perModello.get(e.modello) ?? []), e]);
    }
    console.log(
      "  modello".padEnd(18) +
        "costo 4 dom.".padStart(14) +
        "interr.".padStart(9) +
        "sql".padStart(6) +
        "elenchi".padStart(9) +
        "non verif.".padStart(12) +
        "errori".padStart(8) +
        "secondi".padStart(9) +
        "falliti".padStart(9)
    );
    for (const [nome, righe] of perModello) {
      const ok = righe.filter((r) => r.ok);
      console.log(
        `  ${nome}`.padEnd(18) +
          `${(righe.reduce((s, r) => s + r.costoUsd, 0) * 100).toFixed(1)} cent`.padStart(14) +
          `${ok.reduce((s, r) => s + r.interrogazioni, 0)}`.padStart(9) +
          `${ok.reduce((s, r) => s + r.sqlEseguiti, 0)}`.padStart(6) +
          `${ok.reduce((s, r) => s + r.valoriElencati, 0)}`.padStart(9) +
          `${ok.reduce((s, r) => s + r.nonVerificati, 0)}`.padStart(12) +
          `${ok.reduce((s, r) => s + r.passiErrore, 0)}`.padStart(8) +
          `${Math.round(righe.reduce((s, r) => s + r.secondi, 0))}`.padStart(9) +
          `${righe.filter((r) => !r.ok).length}`.padStart(9)
      );
    }
    const totale = esiti.reduce((s, r) => s + r.costoUsd, 0);
    console.log(`\n  Speso in tutto: $${totale.toFixed(4)}`);

    // Su file, non solo a schermo: vitest intercetta lo stdout, e una misura
    // che costa denaro non puo' dipendere da come viene stampata. Due giri
    // sono gia' andati persi cosi'.
    mkdirSync("docs/bi", { recursive: true });
    writeFileSync(
      "docs/bi/ESITO-confronto-modelli.json",
      JSON.stringify({ eseguitoIl: new Date().toISOString(), totaleUsd: totale, esiti }, null, 2),
      "utf8"
    );
    console.log("\n╚═════════════════════════════════════════════════════════════\n");
  });
});
