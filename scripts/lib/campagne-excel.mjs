/**
 * campagne-excel.mjs — Dal foglio "Database clienti AF" al piano di import del
 * Portale Campagne (migration 131). Solo logica pura: niente file, niente DB.
 * La lettura dell'xlsx e le scritture stanno in scripts/import-campagne-excel.mjs.
 *
 * Il foglio ha UNA riga per cliente e, per ogni campagna, una colonna con lo
 * stato dell'invio e una colonna BANCO. Il significato delle celle l'ha
 * stabilito la ricognizione del 03/10/2026 (vedi Vault, "Campagne Marketing - Spec"):
 *
 *   una data            invio consegnato in quella data (e' la data del DDT)
 *   una data + BANCO    consegnata al banco, stessa data
 *   X                   busta preparata, senza data
 *   stringa vuota       cliente destinatario, nessun invio
 *   RIVENDITORE         escluso (ma si ricalcola dalla categoria: il testo e'
 *                       battuto a mano e su 346 rivenditori ne marca 334)
 *   cella assente       non destinatario
 *
 * Le celle data arrivano gia' convertite in `{ data: "YYYY-MM-DD" }` dal CLI,
 * che le riconosce dal formato: qui non si interpretano seriali.
 */

export const ORIGINE_IMPORT = "import_excel";

/** Seriale Excel (giorni dal 30/12/1899) → "YYYY-MM-DD", senza passare dal fuso orario. */
export function serialeExcelAData(seriale) {
  if (!Number.isFinite(seriale)) throw new Error(`Seriale Excel non valido: ${seriale}`);
  const ms = Date.UTC(1899, 11, 30) + Math.floor(seriale) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const normIntestazione = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const pulisci = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};

/** Cat Attivita che inizia per RIV: stessa regola di campagne.v_clienti. */
export const eRivenditore = (catAttivita) => /^\s*riv/i.test(catAttivita ?? "");

const RE_CAMPAGNA = /^C\s*0?(\d{1,2})\s*_\s*(\d{2})\b/i;

/**
 * Individua le colonne dall'intestazione, non dalla posizione: se qualcuno
 * inserisce una colonna a meta' foglio il mapping continua a tornare.
 * Una campagna e' una colonna "C01_26 - ..."; la sua colonna BANCO e' quella
 * con la stessa sigla e la parola BANCO.
 */
export function trovaColonne(intestazione) {
  const h = intestazione.map(normIntestazione);
  const idx = (re) => h.findIndex((x) => re.test(x));
  const base = {
    codice: idx(/^codice cliente$/i),
    ragione: idx(/^ragione sociale$/i),
    catCommerciale: idx(/^cat commerciale$/i),
    catAttivita: idx(/^cat attivit/i),
    agente: idx(/^agente$/i),
    note: idx(/^note$/i),
  };
  for (const k of ["codice", "ragione"]) {
    if (base[k] < 0) throw new Error(`Intestazione mancante: ${k === "codice" ? "Codice Cliente" : "Ragione Sociale"}`);
  }

  const campagne = new Map();
  h.forEach((x, colonna) => {
    const m = RE_CAMPAGNA.exec(x);
    if (!m) return;
    const codice = `C_${m[1].padStart(2, "0")}_${m[2]}`;
    const voce = campagne.get(codice) ?? { codice, colonna: -1, colonnaBanco: -1, titolo: "" };
    if (/banco/i.test(x)) voce.colonnaBanco = colonna;
    else { voce.colonna = colonna; voce.titolo = x; }
    campagne.set(codice, voce);
  });
  const elenco = [...campagne.values()].filter((c) => c.colonna >= 0);
  if (elenco.length === 0) throw new Error("Nessuna colonna di campagna (C01_26, C02_26, ...) nell'intestazione");
  return { ...base, campagne: elenco };
}

/**
 * Classifica una cella di campagna.
 * @param {unknown} v  null | stringa | { data: "YYYY-MM-DD" }
 */
export function classificaCella(v) {
  if (v === null || v === undefined) return { tipo: "nessuna" };
  if (typeof v === "object" && v.data) return { tipo: "data", data: v.data };
  const s = String(v).replace(/[\u0000-\u001f]/g, " ").trim();
  if (s === "") return { tipo: "vuota" };
  if (/^rivenditore$/i.test(s)) return { tipo: "rivenditore" };
  if (/^x$/i.test(s)) return { tipo: "x" };
  return { tipo: "sconosciuta", testo: s };
}

// Tra due righe dello stesso codice vince il dato piu' informativo.
const FORZA = { data: 4, x: 3, vuota: 2, rivenditore: 1, nessuna: 0, sconosciuta: 0 };

/**
 * Legge le righe (array di celle, intestazione esclusa) in una mappa per codice
 * cliente. I codici doppi si fondono: nel foglio sono lo stesso cliente con due
 * agenti o due destinazioni.
 */
export function leggiClienti(righe, colonne) {
  const avvisi = [];
  const clienti = new Map();

  righe.forEach((r, i) => {
    const numRiga = i + 2; // riga del foglio (intestazione = 1)
    const codice = pulisci(r[colonne.codice]);
    if (!codice) return;

    const dati = {
      codice,
      ragioneSociale: pulisci(r[colonne.ragione]),
      catCommerciale: colonne.catCommerciale >= 0 ? pulisci(r[colonne.catCommerciale]) : null,
      catAttivita: colonne.catAttivita >= 0 ? pulisci(r[colonne.catAttivita]) : null,
      agente: colonne.agente >= 0 ? pulisci(r[colonne.agente]) : null,
      note: colonne.note >= 0 ? pulisci(r[colonne.note]) : null,
    };
    const celle = {};
    for (const c of colonne.campagne) {
      const cella = classificaCella(r[c.colonna]);
      const bancoGrezzo = c.colonnaBanco >= 0 ? pulisci(r[c.colonnaBanco]) : null;
      celle[c.codice] = { cella, banco: bancoGrezzo !== null };
      if (cella.tipo === "sconosciuta") {
        avvisi.push({ tipo: "cella_sconosciuta", codice, dettaglio: `${c.codice}: "${cella.testo}"` });
      }
    }

    const esistente = clienti.get(codice);
    if (!esistente) {
      clienti.set(codice, { ...dati, celle, righe: [numRiga] });
      return;
    }

    // Codice doppio: fondo, e segnalo se le due righe non dicono la stessa cosa.
    const diffs = [];
    if ((dati.ragioneSociale ?? "") !== (esistente.ragioneSociale ?? "")) diffs.push(`nome "${esistente.ragioneSociale}" / "${dati.ragioneSociale}"`);
    if ((dati.agente ?? "") !== (esistente.agente ?? "")) diffs.push(`agente ${esistente.agente ?? "-"} / ${dati.agente ?? "-"}`);
    avvisi.push({
      tipo: "codice_duplicato",
      codice,
      dettaglio: `righe ${esistente.righe.join(",")} e ${numRiga}${diffs.length ? ": " + diffs.join("; ") : " (identiche nei dati anagrafici)"}`,
    });
    esistente.righe.push(numRiga);
    for (const campo of ["ragioneSociale", "catCommerciale", "catAttivita", "agente", "note"]) {
      esistente[campo] = esistente[campo] ?? dati[campo];
    }
    for (const c of colonne.campagne) {
      const a = esistente.celle[c.codice];
      const b = celle[c.codice];
      if (FORZA[b.cella.tipo] > FORZA[a.cella.tipo]) esistente.celle[c.codice] = b;
      else if (b.banco && !a.banco && a.cella.tipo === b.cella.tipo) a.banco = true;
    }
  });

  return { clienti, avvisi };
}

/**
 * Costruisce il piano di import: per ogni campagna i destinatari e gli invii.
 *
 * Destinatario = ha un invio, oppure ha la cella vuota ed e' un cliente che
 * rientra nel pubblico standard di oggi (categoria Attivo, non rivenditore).
 * `includiPotenziali` riapre ai "Potenziale": nel foglio hanno la cella vuota
 * come gli altri, ma la decisione del 03/10/2026 e' di non scrivere a loro.
 *
 * @returns {{ campagne: Array, avvisi: Array, daVerificare: Array }}
 */
export function costruisciPiano(clienti, colonne, { includiPotenziali = false } = {}) {
  const avvisi = [];
  const daVerificare = [];

  for (const c of clienti.values()) {
    if (!c.catCommerciale || !c.catAttivita) {
      daVerificare.push({ codice: c.codice, ragioneSociale: c.ragioneSociale, motivo: "senza categoria", agente: c.agente });
    } else if (!c.agente) {
      daVerificare.push({ codice: c.codice, ragioneSociale: c.ragioneSociale, motivo: "senza agente", agente: null });
    }
  }

  const campagne = colonne.campagne.map((def) => {
    const destinatari = [];
    const invii = [];
    const stats = {
      destinatari: 0, invii: 0, consegnata: 0, consegnata_banco: 0, preparata: 0,
      esclusiPotenziali: 0, escluseRivenditori: 0, rivenditoriMarcatiMaNonCategoria: 0,
    };

    for (const c of clienti.values()) {
      const { cella, banco } = c.celle[def.codice];
      const riv = eRivenditore(c.catAttivita);
      const nota = c.note ? `Nota Excel: ${c.note}` : null;
      let invio = null;

      if (cella.tipo === "data") {
        if (banco) {
          invio = { stato: "consegnata_banco", data_consegna: cella.data };
        } else {
          invio = { stato: "consegnata", data_consegna: cella.data };
        }
      } else if (cella.tipo === "x") {
        if (banco) {
          avvisi.push({ tipo: "banco_senza_data", codice: c.codice, dettaglio: `${def.codice}: BANCO con X e senza data, importata come preparata` });
        }
        invio = { stato: "preparata", data_consegna: null };
      } else if (cella.tipo === "vuota" && banco) {
        avvisi.push({ tipo: "banco_senza_data", codice: c.codice, dettaglio: `${def.codice}: BANCO senza data, ignorato` });
      }

      if (invio) {
        invii.push({
          campagna_codice: def.codice,
          codice_cliente: c.codice,
          ragione_sociale: c.ragioneSociale ?? c.codice,
          stato: invio.stato,
          data_consegna: invio.data_consegna,
          fonte_consegna: invio.data_consegna ? ORIGINE_IMPORT : null,
          origine: ORIGINE_IMPORT,
          note: nota,
        });
        stats.invii++;
        stats[invio.stato]++;
        if (riv) avvisi.push({ tipo: "rivenditore_con_invio", codice: c.codice, dettaglio: `${def.codice}: ${c.catAttivita}, importato perche' ha gia' ricevuto la campagna` });
        destinatari.push(c.codice);
        continue;
      }

      if (cella.tipo === "rivenditore" && !riv) {
        stats.rivenditoriMarcatiMaNonCategoria++;
        avvisi.push({ tipo: "marcato_non_rivenditore", codice: c.codice, dettaglio: `${def.codice}: cella RIVENDITORE ma categoria "${c.catAttivita ?? "-"}"` });
      }
      if (cella.tipo !== "vuota") continue;

      if (riv) {
        stats.escluseRivenditori++;
        avvisi.push({ tipo: "rivenditore_non_marcato", codice: c.codice, dettaglio: `${def.codice}: categoria ${c.catAttivita}, cella non marcata RIVENDITORE: escluso` });
        continue;
      }
      if (!includiPotenziali && !/^attivo$/i.test(c.catCommerciale ?? "")) {
        stats.esclusiPotenziali++;
        continue;
      }
      destinatari.push(c.codice);
    }

    stats.destinatari = destinatari.length;
    return { codice: def.codice, titolo: def.titolo, destinatari, invii, stats };
  });

  // Note di cliente che non finiscono in nessun invio: non vanno perse.
  const conInvio = new Set(campagne.flatMap((c) => c.invii.map((i) => i.codice_cliente)));
  for (const c of clienti.values()) {
    if (c.note && !conInvio.has(c.codice)) {
      avvisi.push({ tipo: "nota_senza_invio", codice: c.codice, dettaglio: `"${c.note}" (${c.ragioneSociale})` });
    }
  }

  return { campagne, avvisi, daVerificare };
}

/** Raggruppa gli avvisi per tipo, per un riepilogo leggibile. */
export function riepilogaAvvisi(avvisi) {
  const per = {};
  for (const a of avvisi) (per[a.tipo] ??= []).push(a);
  return per;
}
