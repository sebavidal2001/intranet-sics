/**
 * IL CALENDARIO E LE REGOLE DELLE DIMENSIONI NELL'ALBERO.
 *
 * Come i campi si raggruppano nell'albero — per operazione, per campi comuni,
 * per misure — sta in `albero-modello.ts`. Qui restano le due cose che non sono
 * un raggruppamento: la scala del tempo e i motivi per cui una dimensione non e'
 * disponibile.
 *
 * Il Calendario e' a parte, e non per estetica: non e' una dimensione come le
 * altre. Giorno, settimana, mese e anno sono la **granularita'** di una sola
 * cosa — il tempo — e si escludono a vicenda, mentre due dimensioni vere
 * convivono. Tenerlo mescolato agli altri farebbe spuntare «mese» e «anno»
 * insieme, che non significa niente.
 */

import type { Dimensione, Granularita } from "./tipi";

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
    case "causale_codice":
      return "Solo per consegnato, banco e preventivi";
    case "soggetto":
    case "condizione_pagamento":
    case "tipo_scadenza":
    case "numero_fattura_fornitore":
    case "profilo_ordine":
      return "Solo per fatture fornitore, condizioni di pagamento e scadenzario";
    case "cap":
    case "provincia":
    case "grado":
    case "tipo_visita":
      return "Solo per le visite";
    case "fornitore":
    case "buyer":
      return "Solo per gli ordini a fornitore";
    default:
      return "Non disponibile per questa misura";
  }
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
  quantita_ordinata: "ordinato",
  quantita_fatturata: "fatturato",
  quantita_consegnata: "consegnato",
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
  n_fatture: "fatturato",
  fattura_media: "fatturato",
  n_consegne: "consegnato",
  consegna_media: "consegnato",
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
  preventivi_inevaso: "preventivi_aperti",
  acquisti_valore: "acquisti",
  acquisti_quantita: "acquisti",
  acquisti_ordini: "acquisti",
  acquisti_righe: "acquisti",
  puntualita_fornitori: "acquisti",
  ritardo_medio_fornitori: "acquisti",
  giorni_consegna_fornitori: "acquisti",
  acquisti_da_sollecitare: "acquisti",
  ritardo_da_sollecitare: "acquisti",
  acquisti_valore_da_sollecitare: "acquisti",
};

/**
 * Le metriche che contano solo i preventivi IN CORSO (causale PIC): il dettaglio
 * dei documenti deve elencare gli stessi, non tutto l'inevaso. Copia di quel che
 * `CATALOGO` sa (`filtroImplicito: preventivoInCorso`), confrontata dal test.
 */
export const METRICHE_SOLO_IN_CORSO: ReadonlySet<string> = new Set([
  "preventivi_aperti",
  "n_preventivi",
  "preventivi_aperti_oltre_90",
  "giorni_apertura",
  "eta_massima_apertura",
]);
