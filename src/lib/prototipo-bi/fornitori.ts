/**
 * Fatture fornitore, condizioni di pagamento e scadenzario.
 *
 * Le fonti sono tre viste della migration 150 (`public.bi_fatture_fornitore`,
 * `bi_documenti_pagamento`, `bi_scadenzario`), estratte ogni notte da Impresa
 * insieme agli ordini a fornitore. Entrano nel motore come tre dataset a se',
 * come gli acquisti e le visite, cosi' metriche, filtri e grafici funzionano
 * senza codice dedicato. Pagina del Vault: «BI - Fornitori, pagamenti e
 * scadenzario».
 *
 * Quello che il gestionale NON permette di fare, e che questi dati non
 * pretendono di fare: dire quale ordine cliente ha causato quale acquisto. Le
 * righe d'ordine a fornitore non hanno provenienza ne' commessa. Per questo la
 * copertura fra incassi e pagamenti si guarda a livello di CALENDARIO (quanto
 * entra e quanto esce, settimana per settimana), non di singolo ordine.
 */

import type { RigaFatto } from "./tipi";

type Grezza = Record<string, unknown>;

const testo = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const data = (v: unknown): string => testo(v).slice(0, 10);

/** Le fatture di vendita: il soggetto e' un cliente. Tutto il resto e' un fornitore. */
const PROFILI_CLIENTE = new Set(["PC", "PCA", "OC", "OCB", "OCINT", "OCT", "FC", "FCA", "FCT"]);
/** Fatture cliente e fornitore: le uniche con scadenze vere. */
export const PROFILI_FATTURA_CLIENTE = new Set(["FC", "FCA", "FCT"]);
export const PROFILI_FATTURA_FORNITORE = new Set(["FF", "FFCEE"]);

function condizione(codice: unknown, descrizione: unknown): string {
  return testo(descrizione) || testo(codice);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fatture fornitore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una riga di fattura fornitore come fatto del motore.
 *
 * `importo` e' `valore_netto` della vista: negativo per le note di credito, che
 * quindi tolgono. `documento` e' «FF 22/2024» (profilo, numero di registrazione
 * del gestionale, anno): il numero scritto dal fornitore NON identifica una
 * fattura (due fornitori diversi hanno lo stesso «1»), quello di registrazione
 * si'. Il numero del fornitore resta disponibile come dimensione a parte, per
 * ritrovare il documento in contabilita'.
 */
export function fatturaFornitoreComeFatto(g: Grezza): RigaFatto {
  const registrazione = data(g.data_registrazione);
  const profilo = testo(g.profilo);
  const fornitore = testo(g.fornitore) || "(senza fornitore)";
  return {
    data: data(g.data_fattura) || registrazione,
    importo: num(g.valore_netto),
    bu: "",
    categoria: testo(g.gruppo_articoli) || "-",
    agente: "",
    codiceAgente: "",
    cliente: "",
    codiceCliente: "",
    documento: `${profilo} ${num(g.numero_registrazione)}/${registrazione.slice(0, 4)}`,
    articolo: testo(g.codice_articolo).toUpperCase(),
    descrizioneArticolo: testo(g.descrizione),
    quantita: num(g.quantita_netta),
    fornitore,
    soggetto: fornitore,
    profilo,
    condizione: condizione(g.condizione_codice, g.condizione_descrizione),
    numeroDocumentoOrigine: testo(g.numero_fattura),
    profiloOrdine: testo(g.profilo_ordine),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Documenti con condizione di pagamento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un documento con la sua condizione di pagamento.
 *
 * `giorniMedi` e' null quando il documento non ha scadenze (quasi tutti gli
 * ordini): la media dei giorni deve ignorarlo, non contarlo come zero.
 */
export function pagamentoComeFatto(g: Grezza): RigaFatto {
  const profilo = testo(g.profilo);
  const registrazione = data(g.data_registrazione);
  const soggetto = testo(g.soggetto) || "(senza soggetto)";
  const cliente = PROFILI_CLIENTE.has(profilo);
  const giorni = g.giorni_medi === null || g.giorni_medi === undefined ? null : num(g.giorni_medi);
  return {
    data: data(g.data_documento) || registrazione,
    importo: num(g.importo_documento),
    bu: "",
    categoria: "-",
    agente: "",
    codiceAgente: "",
    cliente: cliente ? soggetto : "",
    codiceCliente: cliente ? testo(g.codice_soggetto) : "",
    documento: `${profilo} ${num(g.numero_registrazione)}/${registrazione.slice(0, 4)}`,
    articolo: "",
    descrizioneArticolo: "",
    quantita: 1,
    ...(cliente ? {} : { fornitore: soggetto }),
    soggetto,
    profilo,
    condizione: condizione(g.condizione_codice, g.condizione_descrizione),
    numeroDocumentoOrigine: testo(g.numero_documento),
    giorniMedi: giorni,
    importoScadenze: num(g.importo_scadenze),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scadenzario
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una scadenza aperta come fatto del motore.
 *
 * La data di riga e' la data di SCADENZA: «per mese» vuol dire «quanto scade in
 * quel mese», che e' la base del calendario di cassa. `importo` e' il saldo
 * aperto col segno del flusso: positivo per gli incassi attesi, negativo per i
 * pagamenti dovuti, cosi' sommarli da' il netto.
 */
export function scadenzaComeFatto(g: Grezza): RigaFatto {
  const tipo = testo(g.tipo) === "P" ? "P" : "A";
  const saldo = Math.abs(num(g.saldo));
  const soggetto = testo(g.soggetto) || "(senza documento)";
  const documento = testo(g.profilo) ? `${testo(g.profilo)} ${testo(g.numero_documento)}` : `scadenza ${num(g.id_scadenza)}`;
  return {
    data: data(g.data_scadenza),
    importo: tipo === "A" ? saldo : -saldo,
    bu: "",
    categoria: "-",
    agente: "",
    codiceAgente: "",
    cliente: tipo === "A" ? soggetto : "",
    codiceCliente: tipo === "A" ? testo(g.codice_soggetto) : "",
    documento,
    articolo: "",
    descrizioneArticolo: "",
    quantita: 1,
    ...(tipo === "P" ? { fornitore: soggetto } : {}),
    soggetto,
    profilo: testo(g.profilo) || "(senza documento)",
    condizione: testo(g.condizione_codice),
    tipoScadenza: tipo,
    saldoAperto: saldo,
  };
}
