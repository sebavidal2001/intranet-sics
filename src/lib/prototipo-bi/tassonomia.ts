/**
 * La tassonomia traduce il catalogo tecnico nel linguaggio usato in azienda,
 * così il builder può mostrare solo scelte pertinenti senza duplicare la
 * conoscenza sui dataset che alimentano le metriche.
 */

import { CATALOGO, DIMENSIONI } from "./semantico";
import type { ChiaveMetrica, Dimensione } from "./tipi";

export type ChiaveTipologia =
  | "ordinato"
  | "fatturato"
  | "consegnato"
  | "preventivi"
  | "back_office"
  | "banco"
  | "budget";

export interface Tipologia {
  chiave: ChiaveTipologia;
  etichetta: string;
  descrizione: string;
  metriche: ChiaveMetrica[];
}

export const TIPOLOGIE: Tipologia[] = [
  {
    chiave: "ordinato",
    etichetta: "Ordinato",
    descrizione: "Ordini ricevuti e valore medio degli ordini.",
    metriche: ["ordinato", "n_ordini", "ordine_medio"],
  },
  {
    chiave: "fatturato",
    etichetta: "Fatturato",
    descrizione: "Valore delle fatture emesse.",
    metriche: ["fatturato"],
  },
  {
    chiave: "consegnato",
    etichetta: "Consegnato",
    descrizione: "Merce consegnata, portafoglio e consegne future.",
    metriche: ["consegnato", "portafoglio", "consegnato_futuro"],
  },
  {
    chiave: "preventivi",
    etichetta: "Preventivi",
    descrizione: "Valore, volume ed esito delle offerte commerciali.",
    metriche: [
      "preventivi_valore",
      "preventivi_convertito",
      "tasso_conversione",
      "valore_medio_preventivo",
      "n_preventivi",
      "preventivi_aperti",
    ],
  },
  {
    chiave: "back_office",
    etichetta: "Back office",
    descrizione: "Carico di lavoro, tempi di risposta e anzianità.",
    metriche: [
      "preventivi_creati",
      "righe_preventivo",
      "giorni_risposta",
      "quota_stesso_giorno",
      "giorni_apertura",
      "preventivi_aperti_oltre_90",
      "eta_massima_apertura",
    ],
  },
  {
    chiave: "banco",
    etichetta: "Banco",
    descrizione: "Vendite e movimenti gestiti al banco.",
    metriche: ["banco"],
  },
  {
    chiave: "budget",
    etichetta: "Budget",
    descrizione: "Obiettivi commerciali e punto di pareggio.",
    metriche: ["budget", "bep"],
  },
];

const DIMENSIONI_COMUNI: Dimensione[] = ["bu", "agente", "cliente", "categoria", "articolo"];

/** Le dimensioni che hanno senso per questa metrica. */
export function dimensioniPerMetrica(metrica: ChiaveMetrica): Dimensione[] {
  const dataset = CATALOGO[metrica].dataset;
  const dimensioni = [...DIMENSIONI_COMUNI];

  if (dataset === "preventivi_aperti") {
    dimensioni.push("creatore", "esito", "fascia_eta");
  }

  // Il dataset delle consegne e quello del banco sono gli unici che espongono
  // una causale di movimento; portafoglio e consegne future non la conservano.
  if (dataset === "consegnato" || dataset === "controllo_banco") {
    dimensioni.push("causale");
  }

  return dimensioni.filter((dimensione) => dimensione in DIMENSIONI);
}
