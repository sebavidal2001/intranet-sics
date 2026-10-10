/**
 * TUTTO CIO' CHE IL DATABASE HA, USABILE NEL BUILDER.
 *
 * Qui entrano nel motore i dati che c'erano ma il builder non vedeva:
 *
 *  · documenti per utente creatore (migration 151): il carico di lavoro;
 *  · anagrafica dei clienti (migration 140): categorie, zona, agente, tipo;
 *  · articoli per magazzino e variazioni di costo (migration 152);
 *  · spedizioni, cioe' i documenti di trasporto (migration 152).
 *
 * Come per acquisti, visite e fatture fornitore, ciascuno e' un dataset a se':
 * metriche, filtri e grafici funzionano senza codice dedicato, e se una vista
 * non e' raggiungibile il dataset resta assente invece di fermare le vendite.
 *
 * Due funzioni, in fondo, AGGANCIANO dati alle righe che gia' c'erano:
 *  · la condizione di pagamento del documento (da `bi_documenti_pagamento`) a
 *    ordinato, fatturato, consegnato, portafoglio, preventivi e ordini a
 *    fornitore: verificato il 10/10/2026, combacia al 100% su ordini, preventivi
 *    e portafoglio, e al 99% sul fatturato;
 *  · l'anagrafica del cliente (categoria di attivita', categoria commerciale,
 *    zona, tipo) a ogni riga che ha un codice cliente.
 */

import type { RigaFatto } from "./tipi";

type Grezza = Record<string, unknown>;

const testo = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOpz = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const data = (v: unknown): string => testo(v).slice(0, 10);

/** I documenti dell'area acquisti: tutto il resto e' dell'area vendite. */
export const PROFILI_AREA_ACQUISTI = new Set(["OF", "OFT", "OFR", "BF", "FF", "FFCEE", "NAF", "NAFCEE"]);
export const PROFILI_AREA_VENDITE = new Set(["PC", "PCA", "OC", "OCB", "OCINT", "OCT", "BC", "FC", "FCA", "FCT", "NAC"]);

// ─────────────────────────────────────────────────────────────────────────────
// Documenti per utente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un documento con l'utente che l'ha creato.
 *
 * La data di riga e' quella di CREAZIONE (il giorno in cui qualcuno ha
 * lavorato), non quella di registrazione: le fatture fornitore, per esempio,
 * si registrano a fine mese. `quantita` porta il numero di righe, cioe' il lavoro
 * di inserimento.
 */
export function documentoUtenteComeFatto(g: Grezza): RigaFatto {
  const registrazione = data(g.data_registrazione);
  const creazione = testo(g.data_creazione);
  const profilo = testo(g.profilo);
  const soggetto = testo(g.soggetto) || "(senza soggetto)";
  const acquisti = PROFILI_AREA_ACQUISTI.has(profilo);
  const utente = testo(g.utente) || testo(g.codice_utente) || "(sconosciuto)";
  return {
    data: creazione.slice(0, 10) || registrazione,
    importo: num(g.importo_documento),
    bu: "",
    categoria: "-",
    agente: "",
    codiceAgente: "",
    cliente: acquisti ? "" : soggetto,
    codiceCliente: acquisti ? "" : testo(g.codice_soggetto),
    documento: `${profilo} ${num(g.numero_registrazione)}/${registrazione.slice(0, 4)}`,
    articolo: "",
    descrizioneArticolo: "",
    quantita: num(g.n_righe),
    ...(acquisti ? { fornitore: soggetto } : {}),
    soggetto,
    profilo,
    creatore: utente,
    oraCreazione: creazione.length >= 13 ? creazione.slice(11, 13) : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anagrafica clienti
// ─────────────────────────────────────────────────────────────────────────────

export interface AnagraficaCliente {
  catAttivita: string;
  catCommerciale: string;
  zonaCliente: string;
  tipoCliente: string;
  clienteAttivo: string;
}

/** Un cliente come fatto: la data e' quella di creazione dell'anagrafica. */
export function clienteComeFatto(g: Grezza): RigaFatto {
  const anagrafica = anagraficaDaVista(g);
  return {
    data: data(g.creato_il) || data(g.modificato_il) || "2000-01-01",
    importo: 0,
    bu: "",
    categoria: "-",
    agente: testo(g.agente) || "(senza agente)",
    codiceAgente: testo(g.agente_codice),
    cliente: testo(g.ragione_sociale) || "(senza nome)",
    codiceCliente: testo(g.codice_cliente),
    documento: testo(g.codice_cliente),
    articolo: "",
    descrizioneArticolo: "",
    quantita: 1,
    cap: testo(g.cap),
    localita: testo(g.localita),
    provincia: testo(g.provincia).toUpperCase(),
    ...anagrafica,
  };
}

export function anagraficaDaVista(g: Grezza): AnagraficaCliente {
  const attivo = g.attivo;
  return {
    catAttivita: testo(g.cat_attivita),
    catCommerciale: testo(g.cat_commerciale),
    zonaCliente: testo(g.cat_zona),
    tipoCliente: testo(g.tipo),
    clienteAttivo: attivo === true || testo(attivo).toUpperCase() === "S" || testo(attivo) === "true" ? "Attivo" : attivo === false || testo(attivo).toUpperCase() === "N" || testo(attivo) === "false" ? "Non attivo" : "",
  };
}

/** Il codice cliente -> la sua anagrafica. */
export function mappaAnagrafica(grezze: Grezza[]): Map<string, AnagraficaCliente> {
  const m = new Map<string, AnagraficaCliente>();
  for (const g of grezze) {
    const codice = testo(g.codice_cliente);
    if (codice) m.set(codice, anagraficaDaVista(g));
  }
  return m;
}

/** Aggancia categoria, zona e tipo del cliente a ogni riga che ha un codice cliente. */
export function agganciaAnagrafica(righe: RigaFatto[], mappa: Map<string, AnagraficaCliente>): void {
  if (mappa.size === 0) return;
  for (const r of righe) {
    if (!r.codiceCliente) continue;
    const a = mappa.get(r.codiceCliente);
    if (!a) continue;
    r.catAttivita = a.catAttivita;
    r.catCommerciale = a.catCommerciale;
    r.zonaCliente = a.zonaCliente;
    r.tipoCliente = a.tipoCliente;
    r.clienteAttivo = a.clienteAttivo;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Condizione di pagamento agganciata ai documenti
// ─────────────────────────────────────────────────────────────────────────────

/** La chiave con cui una riga di vendita trova il suo documento. */
export function chiaveCondizioneVendita(profilo: string, numero: string | number, codiceCliente: string, dataDocumento: string): string {
  return `${profilo}|${numero}|${codiceCliente}|${dataDocumento}`;
}

/**
 * Le condizioni per documento, da `bi_documenti_pagamento`.
 *
 * Due chiavi per lo stesso documento: quella delle VENDITE (profilo, numero di
 * registrazione, codice cliente, data di registrazione) e quella degli ORDINI A
 * FORNITORE, che portano gia' «OF 12/2026» nel documento e non conoscono il
 * codice del fornitore.
 */
export function mappaCondizioni(grezze: Grezza[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of grezze) {
    const condizione = testo(g.condizione_descrizione) || testo(g.condizione_codice);
    if (!condizione) continue;
    const profilo = testo(g.profilo);
    const registrazione = data(g.data_registrazione);
    const numero = num(g.numero_registrazione);
    m.set(chiaveCondizioneVendita(profilo, numero, testo(g.codice_soggetto), registrazione), condizione);
    m.set(`${profilo} ${numero}/${registrazione.slice(0, 4)}`, condizione);
  }
  return m;
}

/** Aggancia la condizione di pagamento alle righe di vendita (per chiave di vendita). */
export function agganciaCondizioniVendite(righe: RigaFatto[], mappa: Map<string, string>): void {
  if (mappa.size === 0) return;
  for (const r of righe) {
    if (!r.profilo || !r.documento || r.condizione) continue;
    const c = mappa.get(chiaveCondizioneVendita(r.profilo, r.documento, r.codiceCliente, r.data));
    if (c) r.condizione = c;
  }
}

/** Aggancia la condizione di pagamento agli ordini a fornitore (il documento e' «OF 12/2026»). */
export function agganciaCondizioniAcquisti(righe: RigaFatto[], mappa: Map<string, string>): void {
  if (mappa.size === 0) return;
  for (const r of righe) {
    if (r.condizione) continue;
    const c = mappa.get(r.documento);
    if (c) r.condizione = c;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Articoli e variazioni di costo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un articolo in un magazzino come fatto.
 *
 * E' una FOTOGRAFIA dell'ultimo caricamento: la data di riga e' quella del
 * caricamento, non una data di movimento, quindi il tempo del grafico non ha
 * senso e il periodo scelto deve contenere oggi. `documento` e' il codice
 * articolo: contare i «documenti» distinti da' il numero di articoli, non di
 * articoli per magazzino.
 */
export function articoloComeFatto(g: Grezza): RigaFatto {
  const codice = testo(g["Codice Articolo"]).toUpperCase();
  const esistenza = num(g["Esistenza"]);
  const costo = numOpz(g["Ultimo Costo"]);
  const gruppo = testo(g["Gruppo"]);
  return {
    data: data(g["Aggiornato Il"]),
    importo: 0,
    bu: gruppo.toUpperCase(),
    categoria: testo(g["Categoria"]) || "-",
    agente: "",
    codiceAgente: "",
    cliente: "",
    codiceCliente: "",
    documento: codice,
    articolo: codice,
    descrizioneArticolo: testo(g["Descrizione"]),
    quantita: esistenza,
    fornitore: testo(g["Fornitore"]) || "(senza fornitore)",
    magazzino: testo(g["Magazzino"]) || "(non indicato)",
    reparto: testo(g["Reparto"]) || "(non indicato)",
    esistenza,
    disponibilita: num(g["Disponibilita"]),
    qtaOrdClienti: num(g["Qta Ord Clienti"]),
    qtaOrdFornitori: num(g["Qta Ord Fornitori"]),
    qtaImpProduzione: num(g["Qta Imp Produzione"]),
    qtaOrdProduzione: num(g["Qta Ord Produzione"]),
    ultimoCosto: costo !== null && costo > 0 ? costo : null,
    valoreGiacenza: costo !== null && costo > 0 ? Math.max(0, esistenza) * costo : 0,
  };
}

/** Una variazione dell'ultimo costo come fatto: `importo` e' la differenza, `variazionePct` la percentuale. */
export function variazioneCostoComeFatto(g: Grezza): RigaFatto {
  const codice = testo(g["Codice Articolo"]).toUpperCase();
  const giorno = data(g["Data Variazione"]);
  return {
    data: giorno,
    importo: num(g["Delta"]),
    bu: "",
    categoria: "-",
    agente: "",
    codiceAgente: "",
    cliente: "",
    codiceCliente: "",
    documento: `${codice}|${giorno}`,
    articolo: codice,
    descrizioneArticolo: testo(g["Descrizione"]),
    quantita: 1,
    variazionePct: numOpz(g["Delta %"]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spedizioni
// ─────────────────────────────────────────────────────────────────────────────

/** Un documento di trasporto come fatto: `importo` e' la spesa di trasporto addebitata. */
export function spedizioneComeFatto(g: Grezza): RigaFatto {
  const registrazione = data(g.data_registrazione);
  const profilo = testo(g.codice_profilo);
  const giorno = data(g.data_documento) || registrazione;
  const soggetto = testo(g.soggetto) || "(senza soggetto)";
  return {
    data: giorno,
    importo: num(g.val_spese),
    bu: "",
    categoria: "-",
    agente: "",
    codiceAgente: "",
    cliente: "",
    codiceCliente: "",
    documento: `${profilo} ${num(g.numero_progressivo)}/${giorno.slice(0, 4)}`,
    articolo: "",
    descrizioneArticolo: "",
    quantita: 1,
    soggetto,
    profilo,
    vettore: testo(g.vettore) || "(senza vettore)",
    tipoTrasporto: testo(g.tipo_trasporto) || "(non indicato)",
    causaleTrasporto: testo(g.causale_trasporto) || "(non indicata)",
    direzioneMerce: testo(g.direzione) === "ENTRATA" ? "Merce in entrata" : "Merce in uscita",
    provinciaDestinazione: (testo(g.provincia_destinazione) || testo(g.dest_provincia) || testo(g.soggetto_provincia)).toUpperCase(),
    zonaSpedizione: testo(g.zona_provincia),
    mezzoTrasporto: testo(g.tras_mezzo),
    colli: num(g.num_colli),
    pallet: num(g.num_pallet),
    pesoLordo: num(g.peso_lordo),
    volume: num(g.volume),
    speseTrasporto: num(g.val_spese),
  };
}
