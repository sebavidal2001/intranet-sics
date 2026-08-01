/**
 * cruscotto-parser.mjs — Parser del tracciato "cruscotto_articoli".
 *
 * Fonte: query SQL Anywhere `CRUSCOTTO_ARTICOLI_QUERY_CORRETTA.sql`
 *   OUTPUT TO ... FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8'
 *
 * Caratteristiche REALI del formato (verificate sul campione, non ipotizzate):
 *   - 40 colonne, separatore ';', quote '"' (raddoppiate per l'escape), UTF-8
 *   - decimali con VIRGOLA: "3,630000" → 3.63
 *   - date "2025-02-19 00:00:00.000" → 2025-02-19
 *   - costo assente = campo vuoto "" → resta NULL (mai ereditato dallo storico)
 *   - i CR/LF dentro i campi sono esportati come sequenza LETTERALE "\x0d\x0a"
 *     (FORMAT ASCII non li scrive come byte): vanno decodificati.
 *
 * Usato da: bi-riconcilia-cruscotto.mjs e dall'ingest.
 */

/**
 * Parser CSV conforme al formato prodotto da SQL Anywhere:
 * separatore ';', campi quotati con '"', virgolette interne raddoppiate ("").
 * Le librerie generiche sbagliano questo tracciato (tutti i campi sono quotati),
 * quindi lo interpretiamo direttamente.
 */
export function parseCsv(testo, sep = ";") {
  const righe = [];
  let campo = "";
  let riga = [];
  let inQuote = false;
  const s = testo.charCodeAt(0) === 0xfeff ? testo.slice(1) : testo; // BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; }   // escape ""
        else inQuote = false;
      } else campo += c;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === sep) {
      riga.push(campo); campo = "";
    } else if (c === "\n") {
      riga.push(campo); campo = "";
      if (riga.length > 1 || riga[0] !== "") righe.push(riga);
      riga = [];
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo !== "" || riga.length > 0) { riga.push(campo); righe.push(riga); }
  return righe;
}

/** Le 40 colonne nell'ordine esatto prodotto dalla query. */
export const COLONNE_ATTESE = [
  "codice", "descrizione", "codice_uc",
  "cat_com_articolo_codice", "cat_com_articolo_descrizione",
  "cat_merceologica_codice", "cat_merceologica_descrizione",
  "gruppo_articoli_codice", "gruppo_articoli_descrizione",
  "reparto_codice", "reparto_descrizione",
  "cat_fiscale_codice", "cat_fiscale_descrizione",
  "cat_esposizione_codice", "cat_esposizione_descrizione",
  "Ult_Costo", "data_Ult_Costo",
  "magazzino",
  "qta_rim_iniziale", "qta_caricata", "qta_scaricata",
  "qta_altri_carichi", "qta_altri_scarichi", "qta_imp_produzione",
  "qta_ord_clienti", "qta_ord_fornitori",
  "qta_vis_clienti", "qta_vis_fornitori",
  "qta_reso_clienti", "qta_reso_fornitori",
  "qta_ord_produzione",
  "qta_cl_clienti", "qta_cl_fornitori", "qta_cl_terzi",
  "qta_gruppo_lib_1", "qta_gruppo_lib_2", "qta_gruppo_lib_3", "qta_gruppo_lib_4",
  "esistenza", "disponibilita",
];

/** Colonne quantità → colonne di prodotti_giacenze (nomi DB). */
export const MAPPA_QTA = {
  qta_rim_iniziale: "qta_rim_iniziale",
  qta_caricata: "qta_caricata",
  qta_scaricata: "qta_scaricata",
  qta_altri_carichi: "qta_altri_carichi",
  qta_altri_scarichi: "qta_altri_scarichi",
  qta_imp_produzione: "qta_imp_produzione",
  qta_ord_clienti: "qta_ord_clienti",
  qta_ord_fornitori: "qta_ord_fornitori",
  qta_vis_clienti: "qta_vis_clienti",
  qta_vis_fornitori: "qta_vis_fornitori",
  qta_reso_clienti: "qta_reso_clienti",
  qta_reso_fornitori: "qta_reso_fornitori",
  qta_ord_produzione: "qta_ord_produzione",
  qta_cl_clienti: "qta_cl_clienti",
  qta_cl_fornitori: "qta_cl_fornitori",
  qta_cl_terzi: "qta_cl_terzi",
  qta_gruppo_lib_1: "qta_gruppo_lib_1",
  qta_gruppo_lib_2: "qta_gruppo_lib_2",
  qta_gruppo_lib_3: "qta_gruppo_lib_3",
  qta_gruppo_lib_4: "qta_gruppo_lib_4",
  esistenza: "esistenza",
  disponibilita: "disponibilita",
};

/** Campi storicizzati in bi.giacenze_storico (la disponibilità è derivata: esclusa). */
export const CAMPI_STORICO_GIACENZE = Object.keys(MAPPA_QTA).filter((c) => c !== "disponibilita");

/**
 * Decodifica le sequenze di escape letterali prodotte da FORMAT ASCII
 * ("\x0d\x0a" come TESTO, non come byte) e normalizza gli spazi.
 */
export function pulisciTesto(v) {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .replace(/\\x0d\\x0a/gi, " ")
    .replace(/\\x0d|\\x0a/gi, " ")
    .replace(/\\n|\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s === "" ? null : s;
}

/**
 * Numero in formato italiano: virgola decimale, eventuale separatore migliaia.
 * Ritorna null se vuoto (dato assente), NaN se non interpretabile (anomalia).
 */
export function parseNumIta(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim();
  if (s === "") return null;
  s = s.replace(/[€\s]/g, "");
  // Migliaia con punto SOLO se seguite da 3 cifre e c'è anche la virgola decimale.
  if (s.includes(",")) s = s.replace(/\.(?=\d{3}(\D|$))/g, "");
  s = s.replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Data "2025-02-19 00:00:00.000" (o ISO/dd-mm-yyyy) → "YYYY-MM-DD"; null se vuota. */
export function parseDataIso(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return undefined; // formato non riconosciuto → anomalia
}

/**
 * Verifica che l'intestazione corrisponda esattamente alle 40 colonne attese.
 * Ritorna { ok, mancanti, inattese, ordineDiverso }.
 */
export function validaIntestazione(headers) {
  const norm = headers.map((h) => String(h ?? "").trim());
  const mancanti = COLONNE_ATTESE.filter((c) => !norm.includes(c));
  const inattese = norm.filter((c) => !COLONNE_ATTESE.includes(c));
  const ordineDiverso = norm.length === COLONNE_ATTESE.length &&
    mancanti.length === 0 && inattese.length === 0 &&
    norm.some((c, i) => c !== COLONNE_ATTESE[i]);
  return { ok: mancanti.length === 0 && inattese.length === 0, mancanti, inattese, ordineDiverso, nColonne: norm.length };
}

/**
 * Disponibilità attesa dalle quantità. Formula verificata sui dati reali
 * (0 anomalie su 26.171 righe); quella a 4 termini ne lasciava 42.
 * Speculare a bi.disponibilita_attesa() lato database.
 */
export function disponibilitaAttesa(r) {
  const n = (k) => Number(r[k] ?? 0) || 0;
  return n("esistenza") + n("qta_ord_fornitori") - n("qta_ord_clienti")
       - n("qta_imp_produzione") + n("qta_ord_produzione")
       - n("qta_vis_clienti") - n("qta_cl_fornitori");
}

/** Converte una riga grezza (array) in oggetto tipizzato. */
export function rigaToRecord(headers, riga) {
  const idx = Object.fromEntries(headers.map((h, i) => [String(h).trim(), i]));
  const testo = (c) => pulisciTesto(riga[idx[c]]);
  const num = (c) => parseNumIta(riga[idx[c]]);

  const rec = {
    codice: testo("codice"),
    descrizione: testo("descrizione"),
    uc: testo("codice_uc"),
    fornitore_codice: testo("cat_com_articolo_codice"),
    fornitore: testo("cat_com_articolo_descrizione"),
    cat_merc_codice: testo("cat_merceologica_codice"),
    cat_merc: testo("cat_merceologica_descrizione"),
    gruppo_codice: testo("gruppo_articoli_codice"),
    gruppo: testo("gruppo_articoli_descrizione"),
    reparto_codice: testo("reparto_codice"),
    reparto_desc: testo("reparto_descrizione"),
    cat_fiscale_codice: testo("cat_fiscale_codice"),
    cat_fiscale_desc: testo("cat_fiscale_descrizione"),
    cat_esposizione_codice: testo("cat_esposizione_codice"),
    categoria: testo("cat_esposizione_descrizione"),
    // Costo: vuoto → NULL. MAI ereditato dallo storico.
    ult_costo: num("Ult_Costo"),
    data_ult_costo: parseDataIso(riga[idx["data_Ult_Costo"]]),
    magazzino: testo("magazzino"),
  };
  for (const c of Object.keys(MAPPA_QTA)) rec[MAPPA_QTA[c]] = num(c);
  return rec;
}
