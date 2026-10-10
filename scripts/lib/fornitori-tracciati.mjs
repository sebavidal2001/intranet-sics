/**
 * Tracciati dei CSV delle fatture fornitore, delle condizioni di pagamento e
 * dello scadenzario (migration 150), e la conversione di una riga.
 *
 * Separato dallo script di caricamento perche' i test possano importarlo senza
 * toccare il database.
 */

import { pulisciTesto, parseNumIta, parseDataIso } from "./cruscotto-parser.mjs";

// Tipi: i = intero, n = numero, d = data, t = testo, T = testo maiuscolo.
export const TRACCIATI = {
  fatture_fornitore: {
    profili: new Set(["FF", "FFCEE", "NAF", "NAFCEE"]),
    chiave: "id_riga",
    dataObbligatoria: "data_registrazione",
    colonne: [
      ["id_riga", "i"], ["profilo", "t"], ["numero_registrazione", "i"], ["numero_fattura", "t"],
      ["data_fattura", "d"], ["data_registrazione", "d"], ["codice_fornitore", "t"], ["fornitore", "t"],
      ["codice_articolo", "T"], ["descrizione", "t"], ["gruppo_articoli", "t"], ["quantita", "n"],
      ["valore", "n"], ["id_riga_ordine", "i"], ["profilo_ordine", "t"], ["numero_ordine", "i"],
      ["data_ordine", "d"], ["condizione_codice", "t"], ["condizione_descrizione", "t"], ["id_documento", "i"],
    ],
  },
  documenti_pagamento: {
    profili: new Set(["PC", "PCA", "OC", "OCB", "OCINT", "OCT", "FC", "FCA", "FCT", "OF", "OFT", "OFR", "FF", "FFCEE"]),
    chiave: "id_documento",
    dataObbligatoria: "data_registrazione",
    colonne: [
      ["id_documento", "i"], ["profilo", "t"], ["numero_registrazione", "i"], ["numero_documento", "t"],
      ["data_documento", "d"], ["data_registrazione", "d"], ["codice_soggetto", "t"], ["soggetto", "t"],
      ["condizione_codice", "t"], ["condizione_descrizione", "t"], ["importo_documento", "n"],
      ["n_scadenze", "i"], ["prima_scadenza", "d"], ["ultima_scadenza", "d"], ["giorni_medi", "n"],
      ["importo_scadenze", "n"], ["saldo_aperto", "n"], ["sconto_cassa", "n"],
    ],
  },
  scadenzario: {
    tipi: new Set(["A", "P"]),
    chiave: "id_scadenza",
    dataObbligatoria: "data_scadenza",
    colonne: [
      ["id_scadenza", "i"], ["tipo", "t"], ["data_scadenza", "d"], ["data_documento", "d"],
      ["importo", "n"], ["saldo", "n"], ["profilo", "t"], ["numero_documento", "t"],
      ["id_documento", "i"], ["codice_soggetto", "t"], ["soggetto", "t"], ["condizione_codice", "t"],
      ["esito_pagamento", "t"],
    ],
  },
};

function converti(valore, tipo, nome, numRiga) {
  switch (tipo) {
    case "i": {
      const t = String(valore ?? "").trim();
      if (t === "") return null;
      const n = Number(t);
      if (!Number.isInteger(n)) throw new Error(`riga ${numRiga}: ${nome} non e' un intero ("${valore}")`);
      return n;
    }
    case "n": {
      const n = parseNumIta(valore);
      if (n === null) return null;
      if (Number.isNaN(n)) throw new Error(`riga ${numRiga}: ${nome} non numerico ("${valore}")`);
      return n;
    }
    case "d": {
      const d = parseDataIso(valore);
      if (d === undefined) throw new Error(`riga ${numRiga}: ${nome} illeggibile ("${valore}")`);
      return d;
    }
    case "T": return (pulisciTesto(valore) ?? "").toUpperCase() || null;
    default: return pulisciTesto(valore);
  }
}

/**
 * Senza intestazione la struttura si dimostra dai valori: chiave intera
 * positiva, profilo fra quelli estratti, data obbligatoria leggibile. Se il
 * tracciato si spostasse di una colonna, questi controlli smetterebbero di
 * tornare invece di caricare una data nel campo del fornitore.
 */
export function convertiRiga(tracciato, riga, numRiga) {
  if (riga.length !== tracciato.colonne.length) {
    throw new Error(`riga ${numRiga}: ${riga.length} colonne invece di ${tracciato.colonne.length}`);
  }
  /** @type {Record<string, string | number | null>} */
  const out = {};
  tracciato.colonne.forEach(([nome, tipo], i) => {
    out[nome] = converti(riga[i], tipo, nome, numRiga);
  });
  const id = out[tracciato.chiave];
  if (!Number.isInteger(id) || id <= 0) throw new Error(`riga ${numRiga}: ${tracciato.chiave} non valido ("${id}")`);
  if (tracciato.profili && !tracciato.profili.has(out.profilo)) {
    throw new Error(`riga ${numRiga}: profilo inatteso ("${out.profilo}")`);
  }
  if (tracciato.tipi && !tracciato.tipi.has(out.tipo)) {
    throw new Error(`riga ${numRiga}: tipo scadenza inatteso ("${out.tipo}")`);
  }
  if (!out[tracciato.dataObbligatoria]) throw new Error(`riga ${numRiga}: ${tracciato.dataObbligatoria} mancante`);
  // I numeri "0" che il gestionale usa per "nessun legame" diventano assenti.
  for (const nome of ["id_riga_ordine", "numero_ordine", "id_documento"]) {
    if (nome !== tracciato.chiave && out[nome] === 0) out[nome] = null;
  }
  return out;
}

