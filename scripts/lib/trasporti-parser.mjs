/**
 * Parser e validatore del tracciato `trasporti_documenti`.
 *
 * Le 68 colonne e il loro ordine sono il contratto prodotto da
 * scripts/bi-bridge/query/TRASPORTI_DOCUMENTI.sql. I timestamp gestionali
 * restano stringhe locali senza suffisso di fuso: PostgreSQL li riceve in
 * colonne `timestamp without time zone` senza conversioni intermedie.
 */

import { parseCsv, pulisciTesto } from "./cruscotto-parser.mjs";

export { parseCsv };

export const COLONNE_TRASPORTI = [
  "id_documento",
  "direzione",
  "tipo_registro",
  "codice_profilo",
  "descrizione_profilo",
  "numero_progressivo",
  "numero_documento",
  "data_documento",
  "data_registrazione",
  "data_creazione",
  "stampato",
  "contabilizzato",
  "sospeso",
  "bloccato",
  "id_sog_commerciale",
  "codice_soggetto",
  "soggetto",
  "soggetto_piva",
  "soggetto_indirizzo",
  "soggetto_cap",
  "soggetto_localita",
  "soggetto_provincia",
  "id_destinazione",
  "destinazione_codificata",
  "dest_indirizzo_cod",
  "dest_cap_cod",
  "dest_localita_cod",
  "dest_provincia_cod",
  "dest_rag_soc",
  "dest_indirizzo",
  "dest_cap",
  "dest_localita",
  "dest_provincia",
  "provincia_destinazione",
  "zona_cap",
  "zona_provincia",
  "fonte_zona",
  "id_tipo_trasporto",
  "tipo_trasporto_codice",
  "tipo_trasporto",
  "id_caus_trasporto",
  "causale_trasporto_codice",
  "causale_trasporto",
  "tras_mezzo",
  "asp_beni",
  "id_sog_commerciale_vettore",
  "vettore_codice",
  "vettore",
  "num_colli",
  "num_pallet",
  "peso_netto",
  "peso_lordo",
  "volume",
  "id_unita_misura_peso",
  "um_peso",
  "id_unita_misura_volume",
  "um_volume",
  "val_spese",
  "data_trasporto",
  "data_prev_consegna",
  "data_consegna_cliente",
  "note_spedizione",
  "id_utente_crea",
  "codice_utente_creatore",
  "utente_creatore",
  "id_utente_modifica",
  "data_modifica",
  "generato_da",
];

export const PROFILI_TRASPORTI = ["live", "riconciliazione"];

const COLONNE_INTERE = new Set([
  "id_documento",
  "id_sog_commerciale",
  "id_destinazione",
  "id_tipo_trasporto",
  "id_caus_trasporto",
  "id_sog_commerciale_vettore",
  "id_unita_misura_peso",
  "id_unita_misura_volume",
  "id_utente_crea",
  "id_utente_modifica",
]);

const COLONNE_NUMERICHE = new Set([
  "num_colli",
  "num_pallet",
  "peso_netto",
  "peso_lordo",
  "volume",
  "val_spese",
]);

const COLONNE_DATA = new Set([
  "data_documento",
  "data_registrazione",
  "data_trasporto",
  "data_prev_consegna",
  "data_consegna_cliente",
]);

const COLONNE_TIMESTAMP_LOCALI = new Set(["data_creazione", "data_modifica"]);

function dataValida(anno, mese, giorno) {
  const data = new Date(Date.UTC(anno, mese - 1, giorno));
  return data.getUTCFullYear() === anno &&
    data.getUTCMonth() === mese - 1 &&
    data.getUTCDate() === giorno;
}

export function parseDataGestionale(valore) {
  const testo = String(valore ?? "").trim();
  if (testo === "") return null;
  const match = testo.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, anno, mese, giorno] = match;
  return dataValida(Number(anno), Number(mese), Number(giorno)) ? testo : undefined;
}

export function parseTimestampGestionale(valore) {
  const testo = String(valore ?? "").trim();
  if (testo === "") return null;
  const match = testo.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, anno, mese, giorno, ora, minuto, secondo] = match;
  if (!dataValida(Number(anno), Number(mese), Number(giorno)) ||
      Number(ora) > 23 || Number(minuto) > 59 || Number(secondo) > 59) {
    return undefined;
  }
  return `${anno}-${mese}-${giorno} ${ora}:${minuto}:${secondo}`;
}

export function parseIntero(valore) {
  const testo = String(valore ?? "").trim();
  if (testo === "") return null;
  if (!/^-?\d+$/.test(testo)) return Number.NaN;
  const numero = Number(testo);
  return Number.isSafeInteger(numero) ? numero : Number.NaN;
}

export function parseNumero(valore) {
  const testo = String(valore ?? "").trim();
  if (testo === "") return null;
  const numero = Number(testo.replace(",", "."));
  return Number.isFinite(numero) ? numero : Number.NaN;
}

export function validaIntestazioneTrasporti(headers) {
  const normalizzati = headers.map((header) => String(header ?? "").trim().toLowerCase());
  const mancanti = COLONNE_TRASPORTI.filter((colonna) => !normalizzati.includes(colonna));
  const inattese = normalizzati.filter((colonna) => !COLONNE_TRASPORTI.includes(colonna));
  const ordineDiverso = normalizzati.length === COLONNE_TRASPORTI.length &&
    mancanti.length === 0 && inattese.length === 0 &&
    normalizzati.some((colonna, indice) => colonna !== COLONNE_TRASPORTI[indice]);
  return {
    ok: mancanti.length === 0 && inattese.length === 0 && !ordineDiverso,
    mancanti,
    inattese,
    ordineDiverso,
    nColonne: normalizzati.length,
    headers: normalizzati,
  };
}

export function validaProfiloTrasporti(profilo) {
  const normalizzato = String(profilo ?? "").trim().toLowerCase();
  if (!PROFILI_TRASPORTI.includes(normalizzato)) {
    throw new Error(`Profilo non valido: ${profilo ?? ""}. Attesi live o riconciliazione`);
  }
  return normalizzato;
}

export function convertiRigaTrasporti(headers, riga, runId, numeroRiga) {
  if (headers.length !== COLONNE_TRASPORTI.length || riga.length !== COLONNE_TRASPORTI.length) {
    throw new Error(
      `riga ${numeroRiga}: trovate ${riga.length} colonne, attese ${COLONNE_TRASPORTI.length}`,
    );
  }

  const record = { run_id: runId, riga_num: numeroRiga };
  for (let indice = 0; indice < headers.length; indice++) {
    const colonna = headers[indice];
    const grezzo = riga[indice];
    let valore;

    if (COLONNE_INTERE.has(colonna)) {
      valore = parseIntero(grezzo);
      if (Number.isNaN(valore)) {
        throw new Error(`riga ${numeroRiga}: ${colonna} non intero ("${grezzo}")`);
      }
    } else if (COLONNE_NUMERICHE.has(colonna)) {
      valore = parseNumero(grezzo);
      if (Number.isNaN(valore)) {
        throw new Error(`riga ${numeroRiga}: ${colonna} non numerico ("${grezzo}")`);
      }
    } else if (COLONNE_DATA.has(colonna)) {
      valore = parseDataGestionale(grezzo);
      if (valore === undefined) {
        throw new Error(`riga ${numeroRiga}: ${colonna} non valida ("${grezzo}")`);
      }
    } else if (COLONNE_TIMESTAMP_LOCALI.has(colonna)) {
      valore = parseTimestampGestionale(grezzo);
      if (valore === undefined) {
        throw new Error(`riga ${numeroRiga}: ${colonna} non valido ("${grezzo}")`);
      }
    } else {
      valore = pulisciTesto(grezzo);
    }
    record[colonna] = valore;
  }

  if (!Number.isInteger(record.id_documento) || record.id_documento <= 0) {
    throw new Error(`riga ${numeroRiga}: id_documento deve essere un intero positivo`);
  }
  return record;
}

export function creaBlocchi(righe, dimensione) {
  if (!Number.isInteger(dimensione) || dimensione <= 0) {
    throw new Error("La dimensione dei blocchi deve essere un intero positivo");
  }
  const blocchi = [];
  for (let indice = 0; indice < righe.length; indice += dimensione) {
    blocchi.push(righe.slice(indice, indice + dimensione));
  }
  return blocchi;
}

export function calcolaFinestraDal(capturedAt, giorni = 90) {
  if (!Number.isInteger(giorni) || giorni <= 0) {
    throw new Error("I giorni della finestra devono essere un intero positivo");
  }
  const match = String(capturedAt ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match || !dataValida(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new Error(`captured_at non valido: ${capturedAt ?? ""}`);
  }
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  data.setUTCDate(data.getUTCDate() - giorni);
  return data.toISOString().slice(0, 10);
}

export function parseArgomentiTrasporti(argv) {
  const opzioni = {};
  const posizionali = [];
  for (const elemento of argv) {
    if (!elemento.startsWith("--")) {
      posizionali.push(elemento);
      continue;
    }
    if (elemento === "--dry-run") {
      opzioni.dryRun = true;
      continue;
    }
    const separatore = elemento.indexOf("=");
    if (separatore < 0) throw new Error(`Opzione incompleta: ${elemento}`);
    const nome = elemento.slice(2, separatore);
    const valore = elemento.slice(separatore + 1);
    const mappa = {
      profilo: "profilo",
      "run-id": "runId",
      "captured-at": "capturedAt",
      batch: "batch",
    };
    const chiave = mappa[nome];
    if (!chiave) throw new Error(`Opzione sconosciuta: --${nome}`);
    opzioni[chiave] = valore;
  }
  if (posizionali.length !== 1) {
    throw new Error("Indicare una sola directory del run come primo argomento");
  }
  const profilo = validaProfiloTrasporti(opzioni.profilo);
  const batch = opzioni.batch === undefined ? 2000 : Number(opzioni.batch);
  if (!Number.isInteger(batch) || batch <= 0) {
    throw new Error("--batch deve essere un intero positivo");
  }
  return {
    runDirectory: posizionali[0],
    profilo,
    runId: opzioni.runId ?? null,
    capturedAt: opzioni.capturedAt ?? null,
    batch,
    dryRun: opzioni.dryRun === true,
  };
}
