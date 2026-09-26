/**
 *
 * DETTAGLIO DOCUMENTI — la risalita dal numero alla riga.
 *
 * Un cruscotto che mostra solo aggregati costringe a riaprire il gestionale
 * per rispondere alla domanda più naturale che segue un numero strano:
 * «sì, ma cosa ha chiesto quel cliente?».
 *
 * Qui si scende di due livelli, riusando lo stesso vocabolario di filtri delle
 * metriche: dai filtri attivi all'elenco dei documenti, e da un documento alle
 * sue righe. Nessuna query nuova verso il database: si legge lo snapshot già
 * in memoria.
 */

import { DIMENSIONI } from "./semantico";
import type { ChiaveDataset, Filtro, RigaFatto, Snapshot } from "./tipi";
import { dataNelPeriodo } from "./periodo";

/** Dataset che hanno un dettaglio documentale sensato. */
export const DATASET_DETTAGLIO: ChiaveDataset[] = [
  "preventivi_aperti",
  "ordinato",
  "fatturato",
  "consegnato",
  "portafoglio",
];

export interface RigaDettaglio {
  articolo: string;
  descrizione: string;
  quantita: number;
  quantitaEvasa?: number;
  importo: number;
  valoreTotale?: number;
  convertito?: number;
  categoria: string;
  bu: string;
  causale?: string;
  evasa?: boolean;
  /**
   * Costo unitario valido il giorno della vendita, e margine della riga.
   *
   * `null` significa costo SCONOSCIUTO, mai zero: una riga senza costo esce
   * dal calcolo invece di entrarci a margine pieno.
   */
  costoUnitario?: number | null;
  margine?: number | null;
}

export interface DocumentoSintesi {
  numero: string;
  data: string;
  cliente: string;
  agente: string;
  bu: string;
  creatore?: string;
  righe: number;
  importo: number;
  valoreTotale?: number;
  convertito?: number;
  giorniAperto?: number | null;
  giorniRisposta?: number | null;
  /** Quota del documento già derivata in ordine, 0-100. */
  conversionePct?: number;
  /** Costo del venduto del documento, sulle sole righe di cui si sa il costo. */
  costo?: number | null;
  margine?: number | null;
  marginePct?: number | null;
  /** Quota del valore del documento con un costo noto, 0-100. */
  coperturaPct?: number | null;
}

export interface EsitoDettaglio {
  dataset: ChiaveDataset;
  documenti: DocumentoSintesi[];
  totaleDocumenti: number;
  /** Righe del documento richiesto, se ne è stato indicato uno. */
  righe: RigaDettaglio[] | null;
  documentoSelezionato: string | null;
  avvisi: string[];
}

function passaFiltro(r: RigaFatto, f: Filtro): boolean {
  const dim = DIMENSIONI[f.campo];
  if (!dim) return true;
  // Come nel motore: un filtro senza valori scelti non restringe niente.
  if (Array.isArray(f.valore) ? f.valore.length === 0 : String(f.valore).trim() === "") return true;
  const v = dim.estrai(r);
  switch (f.op) {
    case "eq":
      return v === String(f.valore);
    case "neq":
      return v !== String(f.valore);
    case "in":
      return (Array.isArray(f.valore) ? f.valore : [f.valore]).map(String).includes(v);
    case "contiene":
      return v.toLowerCase().includes(String(f.valore).toLowerCase());
  }
}

export interface RichiestaDettaglio {
  dataset: ChiaveDataset;
  filtri?: Filtro[];
  periodo?: { dal?: string; al?: string; anno?: number; anni?: number[] };
  /** Se valorizzato, si restituiscono anche le righe di questo documento. */
  documento?: string;
  /** Quanti documenti elencare. */
  limite?: number;
  ordina?: "importo" | "data" | "eta";
}

/**
 * Elenca i documenti che rispettano i filtri e, se richiesto, le righe di uno.
 *
 * I documenti sono aggregati per numero: nei dataset commerciali una riga è
 * un articolo, non un documento, e mostrarle piatte renderebbe illeggibile
 * l'elenco.
 */
export function dettaglioDocumenti(
  richiesta: RichiestaDettaglio,
  snapshot: Snapshot
): EsitoDettaglio {
  const avvisi: string[] = [];
  const dataset = richiesta.dataset;

  let righe = snapshot.dataset[dataset] ?? [];
  if (righe.length === 0) {
    avvisi.push(`Nessun dato nel dataset "${dataset}".`);
  }

  const p = richiesta.periodo ?? {};
  righe = righe.filter((r) => {
    if (!r.data) return false;
    return dataNelPeriodo(r.data, p);
  });

  for (const f of richiesta.filtri ?? []) {
    // I filtri su dimensioni che questo dataset non conosce (l'addetto back
    // office esiste solo sui preventivi) svuoterebbero l'elenco senza
    // spiegare perché: meglio ignorarli dicendolo.
    const campione = righe[0];
    if (campione && DIMENSIONI[f.campo].estrai(campione) === "") {
      avvisi.push(`Il filtro "${f.campo}" non si applica a questo dataset ed è stato ignorato.`);
      continue;
    }
    righe = righe.filter((r) => passaFiltro(r, f));
  }

  // ── Aggregazione per documento ────────────────────────────────────────────
  const perDocumento = new Map<string, RigaFatto[]>();
  for (const r of righe) {
    const k = r.documento || "(senza numero)";
    const lista = perDocumento.get(k) ?? [];
    lista.push(r);
    perDocumento.set(k, lista);
  }

  const documenti: DocumentoSintesi[] = [...perDocumento.entries()].map(([numero, rr]) => {
    const importo = rr.reduce((s, r) => s + r.importo, 0);
    const valoreTotale = rr.some((r) => r.valoreTotale !== undefined)
      ? rr.reduce((s, r) => s + (r.valoreTotale ?? 0), 0)
      : undefined;
    const convertito = rr.some((r) => r.convertito !== undefined)
      ? rr.reduce((s, r) => s + (r.convertito ?? 0), 0)
      : undefined;
    // Margine del documento: si sommano le sole righe di cui si conosce il
    // costo, e la copertura dice quanta parte del documento rappresentano.
    // Il segno sta sull'importo, non sulla quantità: su una nota di credito il
    // costo va sottratto, non sommato.
    const conCosto = rr.filter((r) => r.costoUnitario != null);
    const costo = conCosto.reduce(
      (s, r) => s + (r.costoUnitario ?? 0) * r.quantita * (r.importo < 0 ? -1 : 1),
      0
    );
    const ricavoCoperto = conCosto.reduce((s, r) => s + r.importo, 0);
    const assoluto = rr.reduce((s, r) => s + Math.abs(r.importo), 0);
    const assolutoCoperto = conCosto.reduce((s, r) => s + Math.abs(r.importo), 0);

    const eta = rr.map((r) => r.giorniAperto).filter((g): g is number => typeof g === "number");
    const risposta = rr
      .map((r) => r.giorniRisposta)
      .filter((g): g is number => typeof g === "number");

    return {
      numero,
      // Un documento può avere righe con date diverse: si mostra la prima.
      data: rr.map((r) => r.data).sort()[0] ?? "",
      cliente: rr[0].cliente,
      agente: rr[0].agente,
      bu: rr[0].bu,
      creatore: rr[0].creatore,
      righe: rr.length,
      importo: Math.round(importo * 100) / 100,
      valoreTotale: valoreTotale === undefined ? undefined : Math.round(valoreTotale * 100) / 100,
      convertito: convertito === undefined ? undefined : Math.round(convertito * 100) / 100,
      giorniAperto: eta.length > 0 ? Math.max(...eta) : null,
      giorniRisposta: risposta.length > 0 ? Math.min(...risposta) : null,
      conversionePct:
        valoreTotale && valoreTotale > 0 && convertito !== undefined
          ? Math.round((convertito / valoreTotale) * 1000) / 10
          : undefined,
      costo: conCosto.length > 0 ? Math.round(costo * 100) / 100 : null,
      margine: conCosto.length > 0 ? Math.round((ricavoCoperto - costo) * 100) / 100 : null,
      marginePct:
        conCosto.length > 0 && ricavoCoperto !== 0
          ? Math.round(((ricavoCoperto - costo) / ricavoCoperto) * 1000) / 10
          : null,
      coperturaPct: assoluto > 0 ? Math.round((assolutoCoperto / assoluto) * 1000) / 10 : null,
    };
  });

  const ordina = richiesta.ordina ?? "importo";
  documenti.sort((a, b) => {
    if (ordina === "data") return b.data.localeCompare(a.data);
    if (ordina === "eta") return (b.giorniAperto ?? -1) - (a.giorniAperto ?? -1);
    return Math.abs(b.importo) - Math.abs(a.importo);
  });

  const totaleDocumenti = documenti.length;
  const limite = Math.min(500, Math.max(1, richiesta.limite ?? 50));

  // ── Righe del documento selezionato ───────────────────────────────────────
  let dettaglio: RigaDettaglio[] | null = null;
  if (richiesta.documento) {
    const rr = perDocumento.get(richiesta.documento);
    if (!rr) {
      avvisi.push(`Il documento ${richiesta.documento} non rientra nei filtri attivi.`);
    } else {
      dettaglio = rr
        .map((r) => ({
          articolo: r.articolo,
          descrizione: r.descrizioneArticolo,
          quantita: r.quantita,
          importo: r.importo,
          costoUnitario: r.costoUnitario ?? null,
          margine:
            r.costoUnitario == null
              ? null
              : Math.round(
                  (r.importo - r.costoUnitario * r.quantita * (r.importo < 0 ? -1 : 1)) * 100
                ) / 100,
          valoreTotale: r.valoreTotale,
          convertito: r.convertito,
          categoria: r.categoria,
          bu: r.bu,
          causale: r.causaleDescrizione ?? r.causaleCodice,
          evasa: r.evasa,
        }))
        .sort((a, b) => (b.valoreTotale ?? b.importo) - (a.valoreTotale ?? a.importo));
    }
  }

  return {
    dataset,
    documenti: documenti.slice(0, limite),
    totaleDocumenti,
    righe: dettaglio,
    documentoSelezionato: richiesta.documento ?? null,
    avvisi,
  };
}
