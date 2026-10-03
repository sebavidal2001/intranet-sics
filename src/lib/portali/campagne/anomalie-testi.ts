import type { MossaScambio } from "./controllo";
import type { Anomalia, TipoAnomalia } from "./tipi";

/**
 * Cosa dire all'operatrice per ogni anomalia: che cosa e' successo, e che cosa fare.
 * Una funzione sola, usata dalla pagina delle anomalie, dal popup e dalla scheda
 * cliente: lo stesso problema non deve avere tre formulazioni diverse.
 */
export interface DescrizioneAnomalia {
  titolo: string;
  /** Cosa e' successo, in una frase. */
  cosa: string;
  /** Cosa fare. */
  azione: string;
  /** Valori da poter copiare (articolo, testo della riga, numero ordine). */
  da_copiare: { etichetta: string; valore: string }[];
}

export const TITOLO_TIPO: Record<TipoAnomalia, string> = {
  riga_mancante: "Manca la riga DOCUMENTAZIONE nell'ordine",
  ordine_non_trovato: "Ordine non trovato in Impresa",
  campagna_incoerente: "La riga nomina un'altra campagna",
  riga_senza_campagna: "La riga non indica la campagna",
  evasa_senza_ddt: "Riga evasa ma DDT non trovato",
  documentazione_senza_busta: "Riga DOCUMENTAZIONE senza busta preparata",
  ordine_invertito: "Campagne in ordine sbagliato",
};

/** Ordine di importanza per l'elenco: prima cio' che blocca il lavoro. */
export const ORDINE_TIPI: TipoAnomalia[] = [
  "riga_mancante",
  "ordine_invertito",
  "documentazione_senza_busta",
  "ordine_non_trovato",
  "campagna_incoerente",
  "evasa_senza_ddt",
  "riga_senza_campagna",
];

const testo = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export function formattaDataIt(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, g] = iso.slice(0, 10).split("-");
  return g && m && a ? `${g}/${m}/${a}` : iso;
}

const nomeCliente = (a: Anomalia) => a.ragione_sociale ?? a.codice_cliente;
const ordine = (a: Anomalia) => (a.ordine_numero ? `${a.ordine_numero}/${a.ordine_anno ?? ""}`.replace(/\/$/, "") : "");

export function descriviAnomalia(a: Anomalia): DescrizioneAnomalia {
  const d = a.dettaglio;
  const campagna = testo(d.campagna_codice);

  switch (a.tipo) {
    case "riga_mancante":
      return {
        titolo: TITOLO_TIPO.riga_mancante,
        cosa: `Nell'ordine ${ordine(a)}${d.data_ordine ? ` del ${formattaDataIt(testo(d.data_ordine))}` : ""} di ${nomeCliente(a)} non c'è la riga con la documentazione della campagna ${campagna}.`,
        azione: "Inserisci nell'ordine in Impresa la riga con questo articolo e questa descrizione.",
        da_copiare: [
          { etichetta: "Articolo", valore: testo(d.articolo) },
          { etichetta: "Descrizione", valore: testo(d.testo_riga) },
          { etichetta: "N° ordine", valore: a.ordine_numero ?? "" },
        ].filter((x) => x.valore),
      };

    case "ordine_non_trovato":
      return {
        titolo: TITOLO_TIPO.ordine_non_trovato,
        cosa: `L'ordine ${ordine(a)} di ${nomeCliente(a)} non risulta in Impresa. Probabilmente il numero è sbagliato.`,
        azione: "Apri la scheda del cliente e correggi numero e anno dell'ordine.",
        da_copiare: [],
      };

    case "campagna_incoerente": {
      const nominate = Array.isArray(d.campagne_nella_riga) ? (d.campagne_nella_riga as string[]).join(", ") : "";
      return {
        titolo: TITOLO_TIPO.campagna_incoerente,
        cosa: `Nell'ordine ${ordine(a)} di ${nomeCliente(a)} la riga parla di ${nominate || "un'altra campagna"}, ma la busta preparata è ${campagna}.`,
        azione: "Correggi la descrizione della riga in Impresa, oppure la busta nel programma.",
        da_copiare: [],
      };
    }

    case "riga_senza_campagna":
      return {
        titolo: TITOLO_TIPO.riga_senza_campagna,
        cosa: `La riga DOCUMENTAZIONE dell'ordine ${ordine(a)} di ${nomeCliente(a)} non dice quale campagna è.`,
        azione: "Aggiungi il nome della campagna nella descrizione.",
        da_copiare: [{ etichetta: "Descrizione", valore: testo(d.testo_riga) }].filter((x) => x.valore),
      };

    case "evasa_senza_ddt":
      return {
        titolo: TITOLO_TIPO.evasa_senza_ddt,
        cosa: `La riga DOCUMENTAZIONE dell'ordine ${ordine(a)} di ${nomeCliente(a)} risulta evasa, ma non trovo il DDT che la contiene.`,
        azione: "Verifica in Impresa che la busta sia davvero partita.",
        da_copiare: [],
      };

    case "documentazione_senza_busta":
      return {
        titolo: TITOLO_TIPO.documentazione_senza_busta,
        cosa: `Nell'ordine ${ordine(a)}${d.data_ordine ? ` del ${formattaDataIt(testo(d.data_ordine))}` : ""} di ${nomeCliente(a)} c'è la riga DOCUMENTAZIONE${campagna ? ` (${campagna})` : ""}, ma nel programma non risulta nessuna busta preparata.`,
        azione: "Apri la scheda del cliente e registra la busta con referente e ordine.",
        da_copiare: [],
      };

    case "ordine_invertito": {
      const mosse = (d.mosse ?? []) as MossaScambio[];
      const righe = mosse.map(
        (m) =>
          `${m.campagna_codice} è sull'ordine ${m.da.ordine_numero} (parte il ${formattaDataIt(m.da.ordine_data_consegna)}) e andrebbe sul ${m.a.ordine_numero} (${formattaDataIt(m.a.ordine_data_consegna)})`
      );
      return {
        titolo: TITOLO_TIPO.ordine_invertito,
        cosa: `${nomeCliente(a)} ha più buste in lavorazione e le campagne partirebbero in ordine inverso: ${righe.join("; ")}.`,
        azione: "Scambia le buste fisiche, poi premi «Applica scambio» per allineare il programma.",
        da_copiare: [],
      };
    }
  }
}
