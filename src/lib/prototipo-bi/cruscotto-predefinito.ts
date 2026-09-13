/**
 * Il cruscotto storico diventa dati seminabili senza duplicare la logica delle
 * query nelle route: qui entrano soltanto pannelli esprimibili da una singola
 * SpecQuery, così la migrazione non cambia mai il significato dei numeri.
 */

import type { TipoGrafico } from "./scelta-grafico";
import type { SpecQuery } from "./tipi";

export interface AnalisiPredefinita {
  chiave: string;
  titolo: string;
  descrizione?: string;
  spec: SpecQuery;
  grafico?: TipoGrafico;
  larghezza?: number;
}

export interface PaginaPredefinita {
  chiave: string;
  titolo: string;
  ordine: number;
  analisi: AnalisiPredefinita[];
}

/** Nessun pannello migrato deve restare fermo su un periodo proprio. */
export const CHIAVI_CON_PERIODO_FISSO = new Set<string>();

export const CRUSCOTTO_PREDEFINITO: PaginaPredefinita[] = [
  {
    chiave: "sintesi",
    titolo: "Sintesi",
    ordine: 0,
    analisi: [
      {
        chiave: "sintesi.quota-per-bu",
        titolo: "Quota per business unit",
        spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
        grafico: "torta",
      },
    ],
  },
  {
    chiave: "scostamenti",
    titolo: "Scostamenti",
    ordine: 1,
    analisi: [],
  },
  {
    chiave: "clienti",
    titolo: "Clienti",
    ordine: 2,
    analisi: [
      {
        chiave: "clienti.concentrazione-fatturato",
        titolo: "Concentrazione del fatturato",
        descrizione: "Barre per valore e quota cumulata sul totale.",
        spec: {
          metrica: "ordinato",
          raggruppa: ["cliente"],
          ordina: "valore_desc",
          limite: 200,
        },
        grafico: "pareto",
      },
      {
        chiave: "clienti.ordinato-per-agente",
        titolo: "Ordinato per agente",
        spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" },
        grafico: "barre",
      },
      {
        chiave: "clienti.quota-per-bu",
        titolo: "Quota per business unit",
        spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
        grafico: "torta",
      },
    ],
  },
  {
    chiave: "preventivi",
    titolo: "Preventivi",
    ordine: 3,
    analisi: [],
  },
  {
    chiave: "conversione",
    titolo: "Conversione",
    ordine: 4,
    analisi: [
      {
        chiave: "conversione.per-agente",
        titolo: "Conversione per agente",
        spec: {
          metrica: "tasso_conversione",
          raggruppa: ["agente"],
          ordina: "valore_desc",
        },
        grafico: "barre",
      },
      {
        chiave: "conversione.per-addetto-back-office",
        titolo: "Conversione per addetto back office",
        spec: {
          metrica: "tasso_conversione",
          raggruppa: ["creatore"],
          ordina: "valore_desc",
        },
        grafico: "barre",
      },
      {
        chiave: "conversione.valore-per-bu",
        titolo: "Valore preventivato per business unit",
        spec: {
          metrica: "preventivi_valore",
          raggruppa: ["bu"],
          ordina: "valore_desc",
        },
        grafico: "treemap",
      },
      {
        chiave: "conversione.tasso-nel-tempo",
        titolo: "Tasso di conversione nel tempo",
        spec: {
          metrica: "tasso_conversione",
          granularita: "mese",
          raggruppa: ["bu"],
          ordina: "etichetta",
        },
        grafico: "heatmap",
        larghezza: 12,
      },
      {
        chiave: "conversione.concentrazione-preventivato",
        titolo: "Concentrazione del preventivato",
        spec: {
          metrica: "preventivi_valore",
          raggruppa: ["cliente"],
          ordina: "valore_desc",
          limite: 200,
        },
        grafico: "pareto",
        larghezza: 8,
      },
      {
        chiave: "conversione.valore-per-mese",
        titolo: "Valore preventivato per mese",
        spec: {
          metrica: "preventivi_valore",
          granularita: "mese",
          ordina: "etichetta",
        },
        grafico: "barre",
        larghezza: 4,
      },
    ],
  },
  {
    chiave: "backoffice",
    titolo: "Back office",
    ordine: 5,
    analisi: [
      {
        chiave: "backoffice.ritmo-giornaliero",
        titolo: "Il ritmo di lavoro, giorno per giorno",
        spec: { metrica: "righe_preventivo", granularita: "giorno", ordina: "etichetta" },
        grafico: "heatmap",
        larghezza: 12,
      },
      {
        chiave: "backoffice.distribuzione-carico",
        titolo: "Come si distribuisce il carico",
        spec: {
          metrica: "righe_preventivo",
          granularita: "mese",
          raggruppa: ["creatore"],
          ordina: "etichetta",
        },
        grafico: "areeImpilate",
        larghezza: 8,
      },
      {
        chiave: "backoffice.preventivi-per-addetto",
        titolo: "Preventivi per addetto",
        spec: {
          metrica: "preventivi_creati",
          raggruppa: ["creatore"],
          ordina: "valore_desc",
        },
        grafico: "barre",
        larghezza: 4,
      },
      {
        chiave: "backoffice.tempi-risposta-nel-tempo",
        titolo: "Tempi di risposta nel tempo",
        spec: {
          metrica: "giorni_risposta",
          granularita: "mese",
          raggruppa: ["creatore"],
          ordina: "etichetta",
        },
        grafico: "heatmap",
        larghezza: 12,
      },
    ],
  },
];

// NON MIGRATI:
// - Fascia KPI globale: confronti, note e rapporti combinano più query; il portafoglio
//   ignora volutamente l'anno, comportamento non rappresentabile col periodo ereditato.
// - Sintesi: raggiungimento BU, ordinato/budget/BEP mensile e progressivo combinano tre
//   query; l'andamento BU usa serie e totale della BU.
// - Scostamenti: tutti i pannelli calcolano differenze o tabelle da almeno due query.
// - Clienti: "Chi si sta muovendo" e la tabella completa confrontano anno corrente,
//   anno precedente e, per la tabella, andamento mensile.
// - Preventivi: "Preventivi aperti" unisce due KPI e una ripartizione per BU;
//   tutti gli altri pannelli fotografano l'aperto di tutti gli anni. Il periodo
//   ereditato li restringerebbe e cambierebbe i numeri.
// - Conversione: imbuto, composizione per esito e tabelle complete combinano più query.
//   I pannelli di anzianità ignorano volutamente il periodo perché fotografano l'aperto
//   attuale: ereditarlo dalla pagina cambierebbe i numeri.
// - Back office: volume, reattività e quadro completo combinano KPI e rapporti derivati.
