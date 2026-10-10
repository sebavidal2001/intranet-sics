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
  | "budget"
  | "margine"
  | "acquisti"
  | "visite"
  | "pagamenti"
  | "scadenzario"
  /** Le misure personalizzate salvate: non sta in `TIPOLOGIE`, la aggiunge il vocabolario. */
  | "misure";

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
    metriche: ["ordinato", "n_ordini", "ordine_medio", "quantita_ordinata"],
  },
  {
    chiave: "fatturato",
    etichetta: "Fatturato",
    descrizione: "Valore delle fatture emesse.",
    metriche: ["fatturato", "n_fatture", "fattura_media", "quantita_fatturata"],
  },
  {
    chiave: "consegnato",
    etichetta: "Consegnato",
    descrizione: "Merce consegnata, portafoglio e consegne future.",
    metriche: ["consegnato", "n_consegne", "consegna_media", "quantita_consegnata", "portafoglio", "consegnato_futuro"],
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
      "preventivi_inevaso",
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
  {
    chiave: "margine",
    etichetta: "Margine",
    descrizione:
      "Margine sul fatturato, al costo di acquisto valido il giorno della vendita. Da leggere sempre accanto alla copertura costi.",
    metriche: ["margine", "margine_pct", "costo_venduto", "copertura_costi_pct"],
  },
  {
    chiave: "acquisti",
    etichetta: "Acquisti",
    descrizione:
      "Tutto sui fornitori: ordini (volume, puntualità, carico dei buyer, righe da sollecitare), fatture e note di credito, pagamenti dovuti.",
    metriche: [
      "acquisti_valore",
      "acquisti_quantita",
      "acquisti_righe",
      "acquisti_ordini",
      "puntualita_fornitori",
      "giorni_consegna_fornitori",
      "acquisti_da_sollecitare",
      "acquisti_valore_da_sollecitare",
      "fatturato_fornitore",
      "n_fatture_fornitore",
      "pagamenti_dovuti",
    ],
  },
  {
    chiave: "visite",
    etichetta: "Visite commerciali",
    descrizione: "Visite dei commerciali ai clienti: quante, dove, con quale esito. Con la mappa si vede anche il giro di ogni giornata.",
    metriche: ["visite_numero"],
  },
  {
    chiave: "pagamenti",
    etichetta: "Tempi di pagamento",
    descrizione: "Giorni medi di incasso dai clienti e di pagamento ai fornitori, dalle scadenze delle fatture.",
    metriche: ["imponibile_documenti", "n_documenti_pagamento", "giorni_incasso", "giorni_pagamento"],
  },
  {
    chiave: "scadenzario",
    etichetta: "Scadenzario",
    descrizione: "Incassi attesi e pagamenti dovuti per data di scadenza: la base del calendario di cassa.",
    metriche: ["incassi_attesi", "saldo_cassa"],
  },
];

const DIMENSIONI_COMUNI: Dimensione[] = [
  "bu",
  "agente",
  "cliente",
  "categoria",
  "codice_articolo",
  "articolo",
  "codice_cliente",
  "codice_agente",
  "profilo",
  "data_consegna_richiesta",
  "data_consegna_confermata",
  "documento_anno",
  // Ultima di proposito: e' la piu' fine, e negli elenchi conviene che stia in
  // coda alle dimensioni con cui si comincia a guardare.
  "documento",
];

/** Le dimensioni che hanno senso per questa metrica. */
export function dimensioniPerMetrica(metrica: ChiaveMetrica): Dimensione[] {
  const dataset = CATALOGO[metrica].dataset;
  // Gli ordini a fornitore non hanno agente, cliente ne' business unit: le
  // loro dimensioni sono altre. La categoria e' il gruppo articoli.
  if (dataset === "acquisti") {
    return (["fornitore", "buyer", "categoria", "codice_articolo", "articolo", "profilo", "data_promessa", "documento"] as Dimensione[]).filter(
      (dimensione) => dimensione in DIMENSIONI
    );
  }
  if (dataset === "visite") {
    return (["agente", "cliente", "cap", "provincia", "grado", "tipo_visita", "esito_visita", "prossima_visita", "codice_cliente", "codice_agente", "documento"] as Dimensione[]).filter(
      (dimensione) => dimensione in DIMENSIONI
    );
  }
  // Fatture fornitore, pagamenti e scadenze: niente agente, cliente o business
  // unit della vendita. Il fornitore e' sulle fatture e sulle scadenze passive;
  // il soggetto (cliente o fornitore) su tutte e tre.
  if (dataset === "fatture_fornitore") {
    return (["fornitore", "categoria", "codice_articolo", "articolo", "profilo", "condizione_pagamento", "profilo_ordine", "numero_fattura_fornitore", "documento"] as Dimensione[]).filter(
      (dimensione) => dimensione in DIMENSIONI
    );
  }
  if (dataset === "pagamenti") {
    return (["soggetto", "profilo", "condizione_pagamento", "numero_fattura_fornitore", "documento"] as Dimensione[]).filter(
      (dimensione) => dimensione in DIMENSIONI
    );
  }
  if (dataset === "scadenze") {
    // Gli incassi sono dei clienti e i pagamenti dei fornitori: ciascuno ha la
    // propria classificazione, cosi' «pagamenti dovuti» si puo' mettere accanto
    // all'ordinato e al fatturato di un fornitore, e «incassi attesi» accanto a
    // quelli di un cliente. Il saldo (incassi − pagamenti) li mescola: li divide
    // solo per soggetto.
    const proprie: Dimensione[] =
      metrica === "pagamenti_dovuti"
        ? ["fornitore", "soggetto"]
        : metrica === "incassi_attesi"
          ? ["cliente", "codice_cliente", "soggetto"]
          : ["tipo_scadenza", "soggetto"];
    return ([...proprie, "profilo", "condizione_pagamento", "documento"] as Dimensione[]).filter(
      (dimensione) => dimensione in DIMENSIONI
    );
  }
  const dimensioni = [...DIMENSIONI_COMUNI];

  if (dataset === "preventivi_aperti") {
    dimensioni.push("creatore", "esito", "fascia_eta", "causale", "causale_codice");
  }

  // Il dataset delle consegne e quello del banco sono gli unici che espongono
  // una causale di movimento; portafoglio e consegne future non la conservano.
  if (dataset === "consegnato" || dataset === "controllo_banco") {
    dimensioni.push("causale");
  }

  return dimensioni.filter((dimensione) => dimensione in DIMENSIONI);
}
