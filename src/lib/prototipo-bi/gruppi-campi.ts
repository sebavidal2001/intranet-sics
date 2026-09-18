/**
 * COME SI RAGGRUPPANO I CAMPI NELL'ALBERO.
 *
 * Le misure sono già raggruppate da `TIPOLOGIE` in `tassonomia.ts`, che le
 * descrive nel modo in cui in azienda si parla dei dati. Le dimensioni no:
 * `DIMENSIONI` è un elenco piatto di nove voci, e nove caselle una sotto
 * l'altra non dicono a chi guarda che «Agente» e «Cliente» sono la stessa
 * specie di cosa mentre «Mese» è un'altra.
 *
 * Qui i gruppi vengono dichiarati. Sono deliberatamente pochi e con nomi di
 * mestiere: chi apre il pannello deve riconoscere il proprio lavoro, non il
 * modello dati. In Power BI le stesse cose si chiamano `Dim_clienti_agenti` e
 * `Dim_prodotti` — sono i nomi di chi ha costruito il modello, e non aiutano
 * chi lo usa.
 *
 * Il Calendario è a parte, e non per estetica: non è una dimensione come le
 * altre. Giorno, settimana, mese e anno sono la **granularità** di una sola
 * cosa — il tempo — e si escludono a vicenda, mentre due dimensioni vere
 * convivono. Tenerlo mescolato agli altri farebbe spuntare «mese» e «anno»
 * insieme, che non significa niente.
 */

import type { Dimensione, Granularita } from "./tipi";

export interface GruppoDimensioni {
  chiave: string;
  etichetta: string;
  /** Una riga che dice a cosa serve, per chi non lo deduce dal nome. */
  descrizione: string;
  dimensioni: Dimensione[];
}

export const GRUPPI_DIMENSIONI: GruppoDimensioni[] = [
  {
    chiave: "commerciale",
    etichetta: "Clienti e agenti",
    descrizione: "Chi compra e chi vende.",
    dimensioni: ["cliente", "agente"],
  },
  {
    chiave: "azienda",
    etichetta: "Azienda",
    descrizione: "Le divisioni interne.",
    dimensioni: ["bu"],
  },
  {
    chiave: "prodotti",
    etichetta: "Prodotti",
    descrizione: "Che cosa è stato venduto o movimentato.",
    dimensioni: ["categoria", "articolo", "causale"],
  },
  {
    chiave: "operazioni",
    etichetta: "Operazioni",
    descrizione: "La singola fattura, ordine o preventivo.",
    dimensioni: ["documento"],
  },
  {
    chiave: "preventivi",
    etichetta: "Preventivi",
    descrizione: "Disponibili solo sulle metriche dei preventivi.",
    dimensioni: ["creatore", "esito", "fascia_eta"],
  },
];

export interface VoceCalendario {
  chiave: Granularita;
  etichetta: string;
}

/**
 * Dal più fine al più grosso: è l'ordine in cui la gente pensa il tempo, e
 * mette per primo il giorno che è anche il meno usato — ma invertirlo
 * renderebbe l'elenco illeggibile.
 */
export const VOCI_CALENDARIO: VoceCalendario[] = [
  { chiave: "giorno", etichetta: "Giorno" },
  { chiave: "settimana", etichetta: "Settimana" },
  { chiave: "mese", etichetta: "Mese" },
  { chiave: "anno", etichetta: "Anno" },
];

/**
 * Perché una dimensione non è disponibile per la misura scelta.
 *
 * Il messaggio va scritto accanto alla casella disattivata, non lasciato a un
 * `title`: da tablet il passaggio del mouse non esiste, e una casella grigia
 * senza spiegazione sembra un guasto.
 */
export function motivoDimensioneNonAmmessa(dimensione: Dimensione): string {
  switch (dimensione) {
    case "creatore":
    case "esito":
    case "fascia_eta":
      return "Solo per i preventivi";
    case "causale":
      return "Solo per consegnato e banco";
    default:
      return "Non disponibile per questa misura";
  }
}

/** Il gruppo a cui appartiene una dimensione, se dichiarato. */
export function gruppoDi(dimensione: Dimensione): GruppoDimensioni | undefined {
  return GRUPPI_DIMENSIONI.find((gruppo) => gruppo.dimensioni.includes(dimensione));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dal numero ai documenti che lo compongono
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Il dataset documentale dietro ogni metrica, per aprire il dettaglio.
 *
 * Serve al clic su un riquadro: da «ordinato per cliente» si deve poter
 * scendere alle bolle e agli ordini veri, altrimenti il numero resta una cosa
 * da credere sulla parola.
 *
 * Sono elencate **solo** le metriche il cui dataset ha un dettaglio
 * documentale (`DATASET_DETTAGLIO` in `dettaglio.ts`). Budget e BEP non ci
 * sono di proposito: non nascono da documenti, e offrire un drill-down che
 * apre una lista vuota è peggio che non offrirlo.
 *
 * È una copia di quel che `CATALOGO` sa già, tenuta qui perché il componente
 * che la usa gira nel browser. `gruppi-campi.test.ts` la confronta con
 * l'originale: se le due divergono, il test lo dice.
 */
export const DATASET_DI_METRICA: Partial<Record<string, string>> = {
  ordinato: "ordinato",
  n_ordini: "ordinato",
  ordine_medio: "ordinato",
  fatturato: "fatturato",
  costo_venduto: "fatturato",
  margine: "fatturato",
  margine_pct: "fatturato",
  copertura_costi_pct: "fatturato",
  consegnato: "consegnato",
  portafoglio: "portafoglio",
  preventivi_aperti: "preventivi_aperti",
  n_preventivi: "preventivi_aperti",
  preventivi_valore: "preventivi_aperti",
  preventivi_convertito: "preventivi_aperti",
  tasso_conversione: "preventivi_aperti",
  valore_medio_preventivo: "preventivi_aperti",
  preventivi_creati: "preventivi_aperti",
  righe_preventivo: "preventivi_aperti",
  giorni_risposta: "preventivi_aperti",
  quota_stesso_giorno: "preventivi_aperti",
  giorni_apertura: "preventivi_aperti",
  eta_massima_apertura: "preventivi_aperti",
  preventivi_aperti_oltre_90: "preventivi_aperti",
};
