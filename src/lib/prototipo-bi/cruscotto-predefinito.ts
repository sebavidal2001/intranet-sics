/**
 * Il cruscotto storico diventa dati seminabili senza duplicare la logica delle
 * query nelle route: ogni pannello conserva le SpecQuery che producono i suoi
 * numeri, così la migrazione non cambia mai il significato dei dati mostrati.
 */

import type { TipoGrafico } from "./scelta-grafico";
import type { SerieAnalisi, SpecQuery } from "./tipi";

export interface AnalisiPredefinita {
  chiave: string;
  titolo: string;
  descrizione?: string;
  spec: SpecQuery;
  serie?: SerieAnalisi[];
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
        chiave: "sintesi.ordinato-confronto",
        titolo: "Ordinato rispetto all'anno precedente",
        spec: { metrica: "ordinato" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato" } },
          {
            ruolo: "confronto",
            nome: "Anno precedente",
            spec: { metrica: "ordinato", modificatore: "anno_precedente" },
          },
        ],
        grafico: "kpi",
        larghezza: 6,
      },
      {
        chiave: "sintesi.fatturato-confronto",
        titolo: "Fatturato rispetto all'anno precedente",
        spec: { metrica: "fatturato" },
        serie: [
          { ruolo: "principale", nome: "Fatturato", spec: { metrica: "fatturato" } },
          {
            ruolo: "confronto",
            nome: "Anno precedente",
            spec: { metrica: "fatturato", modificatore: "anno_precedente" },
          },
        ],
        grafico: "kpi",
        larghezza: 6,
      },
      {
        chiave: "sintesi.raggiungimento-per-bu",
        titolo: "Raggiungimento per business unit",
        descrizione: "Consuntivo contro budget e BEP, allo stesso periodo.",
        spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
        serie: [
          {
            ruolo: "principale",
            nome: "Ordinato",
            spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
          },
          {
            ruolo: "obiettivo",
            nome: "Budget",
            spec: { metrica: "budget", raggruppa: ["bu"], ordina: "valore_desc" },
          },
          {
            ruolo: "soglia",
            nome: "BEP",
            spec: { metrica: "bep", raggruppa: ["bu"], ordina: "valore_desc" },
          },
        ],
        grafico: "bullet",
      },
      {
        chiave: "sintesi.ordinato-budget-bep-mese",
        titolo: "Ordinato, budget e BEP per mese",
        spec: { metrica: "ordinato", granularita: "mese", ordina: "etichetta" },
        serie: [
          {
            ruolo: "principale",
            nome: "Ordinato",
            spec: { metrica: "ordinato", granularita: "mese", ordina: "etichetta" },
          },
          {
            ruolo: "obiettivo",
            nome: "Budget",
            spec: { metrica: "budget", granularita: "mese", ordina: "etichetta" },
          },
          {
            ruolo: "soglia",
            nome: "BEP",
            spec: { metrica: "bep", granularita: "mese", ordina: "etichetta" },
          },
        ],
        grafico: "combo",
        larghezza: 12,
      },
      {
        chiave: "sintesi.visione-progressiva",
        titolo: "Visione progressiva annua",
        spec: {
          metrica: "ordinato",
          modificatore: "progressivo",
          granularita: "settimana",
          ordina: "etichetta",
        },
        serie: [
          {
            ruolo: "principale",
            nome: "Ordinato",
            spec: { metrica: "ordinato", modificatore: "progressivo", granularita: "settimana", ordina: "etichetta" },
          },
          {
            ruolo: "obiettivo",
            nome: "Budget",
            spec: { metrica: "budget", modificatore: "progressivo", granularita: "settimana", ordina: "etichetta" },
          },
          {
            ruolo: "soglia",
            nome: "BEP",
            spec: { metrica: "bep", modificatore: "progressivo", granularita: "settimana", ordina: "etichetta" },
          },
        ],
        grafico: "linee",
        larghezza: 12,
      },
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
    analisi: [
      {
        chiave: "scostamenti.bu-anno-precedente",
        titolo: "Scostamento per business unit",
        spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" } },
          { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["bu"], ordina: "valore_desc" } },
        ],
        grafico: "barre",
      },
      {
        chiave: "scostamenti.agente-budget",
        titolo: "Scostamento dal budget per agente",
        spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" } },
          { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["agente"], ordina: "valore_desc" } },
        ],
        grafico: "barre",
      },
      {
        chiave: "scostamenti.dove-e-quando",
        titolo: "Dove e quando",
        descrizione: "Scostamento percentuale dal budget per business unit e mese.",
        spec: { metrica: "ordinato", granularita: "mese", raggruppa: ["bu"], ordina: "etichetta" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", granularita: "mese", raggruppa: ["bu"], ordina: "etichetta" } },
          { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", granularita: "mese", raggruppa: ["bu"], ordina: "etichetta" } },
        ],
        grafico: "heatmap",
        larghezza: 12,
      },
      {
        chiave: "scostamenti.bu-completo",
        titolo: "Business unit — analisi completa",
        spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" } },
          { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["bu"], ordina: "valore_desc" } },
          { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"], ordina: "valore_desc" } },
        ],
        grafico: "tabella",
        larghezza: 12,
      },
      {
        chiave: "scostamenti.agenti-completo",
        titolo: "Agenti — analisi completa",
        spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" } },
          { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["agente"], ordina: "valore_desc" } },
          { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["agente"], ordina: "valore_desc" } },
        ],
        grafico: "tabella",
        larghezza: 12,
      },
    ],
  },
  {
    chiave: "clienti",
    titolo: "Clienti",
    ordine: 2,
    analisi: [
      {
        chiave: "clienti.chi-si-sta-muovendo",
        titolo: "Chi si sta muovendo",
        spec: { metrica: "ordinato", raggruppa: ["cliente"], ordina: "valore_desc", limite: 200 },
        serie: [
          { ruolo: "principale", nome: "Anno corrente", spec: { metrica: "ordinato", raggruppa: ["cliente"], ordina: "valore_desc", limite: 200 } },
          { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["cliente"], ordina: "valore_desc", limite: 400 } },
        ],
        grafico: "quadranti",
      },
      {
        chiave: "clienti.analisi-completa",
        titolo: "Clienti — analisi completa",
        spec: { metrica: "ordinato", raggruppa: ["cliente"], ordina: "valore_desc", limite: 200 },
        serie: [
          { ruolo: "principale", nome: "Anno corrente", spec: { metrica: "ordinato", raggruppa: ["cliente"], ordina: "valore_desc", limite: 200 } },
          { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["cliente"], ordina: "valore_desc", limite: 400 } },
          { ruolo: "confronto", nome: "Andamento mensile", spec: { metrica: "ordinato", granularita: "mese", raggruppa: ["cliente"], ordina: "etichetta" } },
        ],
        grafico: "tabella",
        larghezza: 12,
      },
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
        chiave: "conversione.dal-preventivo-all-ordine",
        titolo: "Dal preventivo all'ordine",
        spec: { metrica: "preventivi_valore" },
        serie: [
          { ruolo: "principale", nome: "Preventivato", spec: { metrica: "preventivi_valore" } },
          { ruolo: "confronto", nome: "Convertito in ordine", spec: { metrica: "preventivi_convertito" } },
        ],
        grafico: "imbuto",
      },
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
// - Fascia KPI globale: portafoglio e preventivi aperti ignorano volutamente il periodo
//   della pagina; ordini/ordine medio mescola unità e richiede un rapporto derivato.
// - Sintesi: l'andamento per BU usa piccoli multipli con un totale per riquadro, una forma
//   che i ruoli delle serie non descrivono ancora.
// - Preventivi: "Preventivi aperti" unisce due KPI e una ripartizione per BU;
//   tutti gli altri pannelli fotografano l'aperto di tutti gli anni. Il periodo
//   ereditato li restringerebbe e cambierebbe i numeri.
// - Conversione: composizione per esito e tabelle complete includono quote e rapporti
//   derivati che non corrispondono a una serie grezza.
//   I pannelli di anzianità ignorano volutamente il periodo perché fotografano l'aperto
//   attuale: ereditarlo dalla pagina cambierebbe i numeri.
// - Back office: volume, reattività e quadro completo richiedono rapporti, medie pesate
//   e più unità nello stesso pannello; affiancare le serie grezze cambierebbe il significato.
