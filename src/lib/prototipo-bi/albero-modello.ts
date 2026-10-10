/**
 * COME SI ORGANIZZA L'ALBERO DEI CAMPI.
 *
 * L'albero e' organizzato come ragiona chi lavora: per **operazione** — che cosa
 * e' successo, cioe' ordinato, fatturato, preventivi, acquisti, visite — e per
 * **campi comuni**, cioe' le anagrafiche con cui si suddivide qualunque
 * operazione (clienti e agenti, prodotti, tempo). Non per tecnica.
 *
 * Dentro ogni operazione stanno le cose che le appartengono:
 *   - i **valori** che si possono misurare: una somma di importi, un conteggio
 *     di documenti. Sono i campi «di base», quelli che in Power BI si
 *     trascinano nei Valori scegliendo come aggregarli;
 *   - i **campi per suddividere** che esistono solo li': il numero del
 *     documento (ogni operazione porta il suo: ordine, fattura, preventivo), il
 *     CAP delle visite, il fornitore degli acquisti.
 *
 * Le **misure** — quelle che nascono da un calcolo (un valore medio, un tasso,
 * una percentuale, un numero di giorni) — NON stanno dentro le operazioni: hanno
 * una sezione loro, e ognuna dichiara come si calcola. E' la parte che in Power
 * BI si scrive in DAX; qui e' gia' scritta e certificata, ma la logica deve
 * potersi leggere, sia per fidarsene sia per costruirne una variante.
 *
 * Il modello e' puro (niente React, niente rete): lo legge l'albero, lo legge la
 * tabella, e `albero-modello.test.ts` controlla che non resti fuori nessuna
 * metrica e nessuna dimensione del motore.
 */

import { CATALOGO } from "./semantico";
import type { ChiaveMetrica, Dimensione, Periodo, SpecQuery } from "./tipi";
import { anniDelPeriodo, periodoPresente } from "./periodo";
import type { ChiaveCampo } from "./misure-vocabolario";
import { eChiaveMisura } from "./misure-vocabolario";
import { operandiDellaMisura } from "./misure";
import type { MisuraDefinita } from "./tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Natura di un valore: come e' calcolato
// ─────────────────────────────────────────────────────────────────────────────

export type NaturaValore = "somma" | "conteggio" | "media" | "rapporto" | "massimo";

/** Come si presenta, a chi legge, un valore: un simbolo breve e una dicitura. */
export const NATURE: Record<NaturaValore, { simbolo: string; nome: string; spiegazione: string }> = {
  somma: { simbolo: "Σ", nome: "Somma", spiegazione: "Somma degli importi delle righe." },
  conteggio: { simbolo: "#", nome: "Conteggio", spiegazione: "Quanti sono: documenti o righe, non importi." },
  media: { simbolo: "x̄", nome: "Media", spiegazione: "Valore medio." },
  rapporto: { simbolo: "%", nome: "Rapporto", spiegazione: "Una parte rispetto al tutto, in percentuale." },
  massimo: { simbolo: "↑", nome: "Massimo", spiegazione: "Il valore più alto." },
};

/** La natura di una metrica del catalogo, ricavata dall'aggregazione che il motore usa davvero. */
export function naturaDellaMetrica(metrica: ChiaveMetrica): NaturaValore {
  switch (CATALOGO[metrica].aggregazione) {
    case "somma":
      return "somma";
    case "conta_documenti":
    case "conta_righe":
      return "conteggio";
    case "media_documento":
    case "media":
      return "media";
    case "massimo":
      return "massimo";
    case "rapporto":
      return "rapporto";
  }
}

/**
 * Le metriche che nascono da un calcolo (medie, rapporti, massimi): stanno
 * nella sezione Misure, non dentro l'operazione. Somme e conteggi sono invece i
 * campi di base.
 */
export function eMisuraCalcolata(metrica: ChiaveMetrica): boolean {
  const natura = naturaDellaMetrica(metrica);
  return natura === "media" || natura === "rapporto" || natura === "massimo";
}

/**
 * La natura di una voce dell'albero. Una misura personalizzata e' sempre un
 * calcolo, tranne la «metrica con filtri» che resta la natura della sua metrica.
 */
export function naturaDellaVoce(chiave: ChiaveCampo, definizioni: Record<string, MisuraDefinita> = {}): NaturaValore {
  if (!eChiaveMisura(chiave)) return naturaDellaMetrica(chiave);
  const misura = definizioni[chiave];
  if (misura?.espressione.tipo === "metrica") return naturaDellaMetrica(misura.espressione.metrica);
  return "rapporto";
}

// ─────────────────────────────────────────────────────────────────────────────
// Famiglie: da quale operazione viene un valore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'operazione (il dataset) da cui viene una metrica.
 *
 * Serve a una regola sola, ma importante: il **numero del documento** vale per
 * una operazione alla volta. L'ordine 4521 e la fattura 4521 non hanno niente a
 * che fare, e una tabella che li mettesse sulla stessa riga mostrerebbe un
 * legame che non esiste.
 */
export function famigliaDellaMetrica(metrica: ChiaveMetrica): string {
  return CATALOGO[metrica]?.dataset ?? metrica;
}

/** Le operazioni coinvolte da una misura personalizzata (una per dataset degli operandi). */
export function famiglieDellaMisura(misura: MisuraDefinita): string[] {
  return [...new Set(operandiDellaMisura(misura.espressione).map((o) => famigliaDellaMetrica(o.metrica)))];
}

export const MOTIVO_DOCUMENTO_MISTO =
  "Il numero del documento vale per una sola operazione alla volta: ordini, fatture e preventivi hanno numerazioni diverse.";

/** La stessa ragione, breve: sta sotto ogni misura che un numero di documento gia' scelto esclude. */
export const MOTIVO_MISURA_ALTRA_OPERAZIONE = "Il numero documento vale per una sola operazione";

// ─────────────────────────────────────────────────────────────────────────────
// Le operazioni
// ─────────────────────────────────────────────────────────────────────────────

/** Il numero del documento, con o senza l'anno: stesso concetto, stessa regola. */
export function eDocumento(dimensione: string): boolean {
  return dimensione === "documento" || dimensione === "documento_anno";
}

export interface CampoSuddivisione {
  chiave: Dimensione;
  /** Il nome in questo contesto («Numero ordine» invece di «Documento»), se diverso. */
  etichetta?: string;
}

export interface GruppoOperazione {
  chiave: string;
  etichetta: string;
  descrizione: string;
  /** I valori di base: somme e conteggi. */
  valori: ChiaveMetrica[];
  /** I campi per suddividere che appartengono a questa operazione. */
  campi: CampoSuddivisione[];
  /**
   * Le operazioni (dataset) di cui e' il «numero del documento». Il campo
   * `documento` di questo gruppo e' acceso solo se tutti i valori scelti
   * appartengono a una di queste.
   */
  famiglieDocumento?: string[];
}

export const GRUPPI_OPERAZIONI: GruppoOperazione[] = [
  {
    chiave: "ordinato",
    etichetta: "Ordinato",
    descrizione: "Gli ordini ricevuti dai clienti.",
    valori: ["ordinato", "n_ordini", "quantita_ordinata"],
    campi: [
      { chiave: "documento_anno", etichetta: "Numero ordine/anno" },
      { chiave: "profilo" },
      { chiave: "data_consegna_richiesta" },
      { chiave: "data_consegna_confermata" },
    ],
    famiglieDocumento: ["ordinato"],
  },
  {
    chiave: "fatturato",
    etichetta: "Fatturato",
    descrizione: "Le fatture emesse, con costo e margine.",
    valori: ["fatturato", "n_fatture", "quantita_fatturata", "costo_venduto", "margine"],
    campi: [
      { chiave: "documento_anno", etichetta: "Numero fattura/anno" },
      { chiave: "profilo" },
      { chiave: "data_consegna_richiesta" },
      { chiave: "data_consegna_confermata" },
    ],
    famiglieDocumento: ["fatturato"],
  },
  {
    chiave: "consegnato",
    etichetta: "Consegnato",
    descrizione: "La merce uscita con i documenti di consegna.",
    valori: ["consegnato", "n_consegne", "quantita_consegnata"],
    campi: [
      { chiave: "documento_anno", etichetta: "Numero consegna/anno" },
      { chiave: "profilo" },
      { chiave: "data_consegna_richiesta" },
      { chiave: "data_consegna_confermata" },
    ],
    famiglieDocumento: ["consegnato"],
  },
  {
    chiave: "portafoglio",
    etichetta: "Portafoglio",
    descrizione: "Ordini acquisiti non ancora consegnati.",
    valori: ["portafoglio", "consegnato_futuro"],
    campi: [{ chiave: "documento_anno", etichetta: "Numero ordine/anno" }, { chiave: "profilo" }],
    famiglieDocumento: ["portafoglio"],
  },
  {
    chiave: "preventivi",
    etichetta: "Preventivi",
    descrizione: "Le offerte: valore, esito, carico e anzianità.",
    valori: [
      "preventivi_valore",
      "preventivi_convertito",
      "preventivi_aperti",
      "preventivi_aperti_oltre_90",
      "n_preventivi",
      "preventivi_inevaso",
      "preventivi_creati",
      "righe_preventivo",
    ],
    campi: [
      { chiave: "documento_anno", etichetta: "Numero preventivo/anno" },
      { chiave: "profilo" },
      { chiave: "causale_codice", etichetta: "Codice causale (PIC, POR…)" },
      { chiave: "causale", etichetta: "Causale (descrizione)" },
      { chiave: "creatore" },
      { chiave: "esito" },
      { chiave: "fascia_eta" },
    ],
    famiglieDocumento: ["preventivi_aperti"],
  },
  {
    chiave: "banco",
    etichetta: "Banco",
    descrizione: "Vendite e movimenti gestiti al banco.",
    valori: ["banco"],
    campi: [{ chiave: "documento_anno", etichetta: "Numero documento/anno" }, { chiave: "profilo" }],
    famiglieDocumento: ["controllo_banco"],
  },
  {
    chiave: "acquisti",
    etichetta: "Acquisti",
    descrizione:
      "Tutto sui fornitori: gli ordini, le fatture e le note di credito, i pagamenti dovuti. Metti il fornitore fra i campi e scegli quanti valori vuoi: ordinato, fatturato, pagamenti.",
    valori: [
      "acquisti_valore",
      "acquisti_quantita",
      "acquisti_ordini",
      "acquisti_righe",
      "acquisti_da_sollecitare",
      "acquisti_valore_da_sollecitare",
      "fatturato_fornitore",
      "n_fatture_fornitore",
      "pagamenti_dovuti",
    ],
    // Il numero dell'ordine a fornitore porta gia' profilo e anno («OF 12/2026»),
    // quello di registrazione della fattura pure («FF 22/2024»). Ordini, fatture
    // e scadenze hanno numerazioni diverse: il numero si puo' scegliere solo con
    // valori di una sola di queste (lo dice la regola generale sul documento).
    campi: [
      { chiave: "fornitore" },
      { chiave: "buyer" },
      { chiave: "documento", etichetta: "Numero documento (ordine o fattura)" },
      { chiave: "numero_fattura_fornitore" },
      { chiave: "profilo", etichetta: "Tipo documento" },
      { chiave: "condizione_pagamento" },
      { chiave: "profilo_ordine" },
      { chiave: "data_promessa" },
    ],
    famiglieDocumento: ["acquisti", "fatture_fornitore", "scadenze"],
  },
  {
    chiave: "pagamenti",
    etichetta: "Condizioni di pagamento",
    descrizione:
      "Un documento per riga (preventivi, ordini e fatture, di clienti e fornitori) con la condizione scritta sul documento. Per separare clienti e fornitori usa il tipo documento. I giorni medi di incasso e di pagamento stanno nelle Misure.",
    valori: ["imponibile_documenti", "n_documenti_pagamento"],
    campi: [
      { chiave: "soggetto" },
      { chiave: "profilo", etichetta: "Tipo documento" },
      { chiave: "condizione_pagamento" },
      { chiave: "documento", etichetta: "Documento (registrazione/anno)" },
      { chiave: "numero_fattura_fornitore", etichetta: "Numero del documento di origine" },
    ],
    famiglieDocumento: ["pagamenti"],
  },
  {
    chiave: "scadenzario",
    etichetta: "Scadenzario",
    descrizione:
      "Le scadenze ancora aperte, per data di scadenza: incassi attesi dai clienti e saldo con i pagamenti. I pagamenti dovuti ai fornitori stanno negli Acquisti. Il tempo del grafico è la data di scadenza.",
    valori: ["incassi_attesi", "saldo_cassa"],
    campi: [
      { chiave: "tipo_scadenza" },
      { chiave: "soggetto" },
      { chiave: "fornitore" },
      { chiave: "profilo", etichetta: "Origine (tipo documento)" },
      { chiave: "condizione_pagamento" },
      { chiave: "documento" },
    ],
    famiglieDocumento: ["scadenze"],
  },
  {
    chiave: "visite",
    etichetta: "Visite commerciali",
    descrizione: "Le visite dei commerciali ai clienti: quante, dove, con quale esito. CAP o provincia attivano la mappa.",
    valori: ["visite_numero"],
    campi: [
      { chiave: "cap" },
      { chiave: "provincia" },
      { chiave: "grado" },
      { chiave: "tipo_visita" },
      { chiave: "esito_visita" },
      { chiave: "prossima_visita" },
    ],
  },
  {
    chiave: "budget",
    etichetta: "Budget",
    descrizione: "Obiettivi commerciali e punto di pareggio.",
    valori: ["budget", "bep"],
    campi: [],
  },
];

/** Vero se il periodo sta dentro un anno solo (anno scelto, o intervallo nello stesso anno). */
function periodoDiUnAnno(periodo: Periodo | undefined): boolean {
  if (!periodoPresente(periodo)) return false;
  const anni = anniDelPeriodo(periodo);
  if (anni && anni.length !== 1) return false;
  if (periodo.dal && periodo.al) {
    const mezzo = periodo.dal.slice(0, 4) === periodo.al.slice(0, 4);
    return mezzo && (!anni || anni[0] === Number(periodo.dal.slice(0, 4)));
  }
  return anni !== null && anni.length === 1;
}

/**
 * Un avviso per chi mette il numero del documento in una tabella.
 *
 * Il numero **riparte ogni anno** (e nelle consegne serie diverse hanno gli
 * stessi numeri per clienti diversi): la riga della tabella e' «il numero», e
 * due documenti con lo stesso numero finiscono sulla stessa riga, con i valori
 * sommati. Non si puo' rimediare a monte senza cambiare cosa significa
 * «documento» per tutto il resto, quindi si dice, con la cura: aggiungere il
 * tempo, o limitare il periodo a un anno. `null` se non serve.
 *
 * Gli ordini a fornitore non ne hanno bisogno: il loro numero porta gia'
 * profilo e anno («OF 12/2026»).
 */
export function avvisoNumeroDocumento(
  spec: Pick<SpecQuery, "raggruppa" | "granularita">,
  famiglia: string,
  periodo: Periodo | undefined
): string | null {
  const dimensioni = spec.raggruppa ?? [];
  // Con l'anno nel numero (`documento_anno`) i documenti di anni diversi restano
  // separati: l'avviso vale solo per il numero nudo.
  const senzaAnno = dimensioni.includes("documento");
  if (!dimensioni.some(eDocumento) || famiglia === "acquisti" || famiglia === "visite") return null;
  // Fatture fornitore, pagamenti e scadenze: il numero di registrazione porta gia' profilo e anno.
  if (famiglia === "fatture_fornitore" || famiglia === "pagamenti" || famiglia === "scadenze") return null;
  const parti: string[] = [];
  if (senzaAnno && !spec.granularita && !periodoDiUnAnno(periodo)) {
    parti.push(
      "Il numero del documento riparte ogni anno: con più anni nel periodo, due documenti con lo stesso numero finiscono sulla stessa riga. " +
        "Aggiungi il Calendario (Giorno o Anno) alle colonne, oppure limita il periodo a un anno."
    );
  }
  if (famiglia === "consegnato" && !dimensioni.includes("cliente")) {
    parti.push("Nelle consegne lo stesso numero esiste per clienti diversi: aggiungi anche Cliente per tenerli separati.");
  }
  return parti.length > 0 ? parti.join(" ") : null;
}

/**
 * Come si chiama il numero del documento per le misure di questa operazione:
 * «Numero ordine», «Numero fattura»… Una colonna «Documento» non dice di quale.
 * `undefined` se non e' una operazione con un numero proprio.
 */
export function etichettaDocumento(famiglia: string): string | undefined {
  for (const gruppo of GRUPPI_OPERAZIONI) {
    if (!gruppo.famiglieDocumento?.includes(famiglia)) continue;
    const campo = gruppo.campi.find((c) => eDocumento(c.chiave));
    if (campo?.etichetta) return campo.etichetta;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// I campi comuni
// ─────────────────────────────────────────────────────────────────────────────

export interface GruppoComune {
  chiave: string;
  etichetta: string;
  descrizione: string;
  dimensioni: Dimensione[];
}

/**
 * I campi con cui si suddivide qualunque operazione. La business unit sta con i
 * prodotti: e' la classificazione della merce, non una divisione organizzativa.
 */
export const GRUPPI_COMUNI: GruppoComune[] = [
  {
    chiave: "commerciale",
    etichetta: "Clienti e agenti",
    descrizione: "Chi compra e chi vende.",
    dimensioni: ["cliente", "codice_cliente", "agente", "codice_agente"],
  },
  {
    chiave: "prodotti",
    etichetta: "Prodotti",
    descrizione: "Che cosa è stato venduto: business unit, categoria, articolo.",
    dimensioni: ["bu", "categoria", "codice_articolo", "articolo", "causale"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Le misure calcolate
// ─────────────────────────────────────────────────────────────────────────────

export interface MisuraCalcolata {
  chiave: ChiaveMetrica;
  /** Come si calcola, a parole. E' quello che si legge per fidarsene. */
  calcolo: string;
}

export interface GruppoMisure {
  chiave: string;
  etichetta: string;
  misure: MisuraCalcolata[];
}

export const GRUPPI_MISURE: GruppoMisure[] = [
  {
    chiave: "ordinato",
    etichetta: "Ordinato",
    misure: [
      {
        chiave: "ordine_medio",
        calcolo: "Importo ordinato ÷ numero di ordini. Un ordine con più righe conta una volta sola.",
      },
    ],
  },
  {
    chiave: "fatturato",
    etichetta: "Fatturato e margine",
    misure: [
      {
        chiave: "fattura_media",
        calcolo:
          "Importo fatturato ÷ numero di fatture. Le note di credito sono documenti: contano e abbassano la media.",
      },
      {
        chiave: "margine_pct",
        calcolo:
          "Margine ÷ fatturato × 100, solo sulle righe di cui si conosce il costo di acquisto (valido il giorno della vendita).",
      },
      {
        chiave: "copertura_costi_pct",
        calcolo:
          "Fatturato con costo noto ÷ fatturato totale × 100, in valori assoluti. Da leggere accanto al margine.",
      },
    ],
  },
  {
    chiave: "consegnato",
    etichetta: "Consegnato",
    misure: [
      {
        chiave: "consegna_media",
        calcolo: "Valore consegnato ÷ numero di consegne (DDT e simili, resi compresi).",
      },
    ],
  },
  {
    chiave: "preventivi",
    etichetta: "Preventivi",
    misure: [
      {
        chiave: "valore_medio_preventivo",
        calcolo: "Valore totale dei preventivi ÷ numero di preventivi.",
      },
      {
        chiave: "tasso_conversione",
        calcolo: "Parte di preventivo diventata ordine ÷ valore totale dei preventivi × 100.",
      },
      {
        chiave: "giorni_risposta",
        calcolo:
          "Media dei giorni fra la richiesta del cliente e la registrazione del preventivo. Le date mancanti o incoerenti sono escluse.",
      },
      {
        chiave: "quota_stesso_giorno",
        calcolo:
          "Preventivi registrati lo stesso giorno della richiesta ÷ preventivi con date valide × 100.",
      },
      {
        chiave: "giorni_apertura",
        calcolo:
          "Media dei giorni di attesa dei preventivi ancora aperti, dalla data del documento alla data dei dati.",
      },
      {
        chiave: "eta_massima_apertura",
        calcolo: "Il valore più alto dei giorni di apertura: la riga aperta da più tempo.",
      },
    ],
  },
  {
    chiave: "pagamenti",
    etichetta: "Tempi di pagamento",
    misure: [
      {
        chiave: "giorni_incasso",
        calcolo:
          "Per ogni fattura cliente, i giorni fra la data della fattura e ciascuna scadenza, mediati sull'importo delle rate; poi la media fra le fatture. Dalle scadenze vere.",
      },
      {
        chiave: "giorni_pagamento",
        calcolo:
          "Per ogni fattura fornitore, i giorni fra la data della fattura e ciascuna scadenza, mediati sull'importo delle rate; poi la media fra le fatture. Dalle scadenze vere.",
      },
    ],
  },
  {
    chiave: "acquisti",
    etichetta: "Acquisti",
    misure: [
      {
        chiave: "puntualita_fornitori",
        calcolo:
          "Righe arrivate entro la data promessa ÷ righe già arrivate × 100. Le righe non ancora arrivate non contano.",
      },
      {
        chiave: "giorni_consegna_fornitori",
        calcolo: "Media dei giorni fra l'ordine e il primo arrivo della merce, sulle righe arrivate.",
      },
    ],
  },
];

/** Come si calcola una metrica, se e' una misura calcolata. */
export function calcoloDellaMetrica(metrica: ChiaveMetrica): string | null {
  for (const gruppo of GRUPPI_MISURE) {
    const trovata = gruppo.misure.find((m) => m.chiave === metrica);
    if (trovata) return trovata.calcolo;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// «Calcola come»: lo stesso importo, aggregato in modi diversi
// ─────────────────────────────────────────────────────────────────────────────

export interface AlternativaCalcolo {
  chiave: ChiaveMetrica;
  /** Cosa fa, nei termini che si scelgono in Power BI: somma, conteggio, media. */
  nome: string;
}

/**
 * Per ogni documento commerciale, le tre letture dello stesso campo: la somma
 * degli importi, il numero dei documenti, il valore medio per documento. Chi
 * viene da Power BI le cerca sul campo («Somma di importo ▾»): qui si cambiano
 * dal valore.
 */
export const FAMIGLIE_CALCOLO: AlternativaCalcolo[][] = [
  [
    { chiave: "ordinato", nome: "Somma degli importi" },
    { chiave: "n_ordini", nome: "Numero di ordini" },
    { chiave: "ordine_medio", nome: "Valore medio per ordine" },
  ],
  [
    { chiave: "fatturato", nome: "Somma degli importi" },
    { chiave: "n_fatture", nome: "Numero di fatture" },
    { chiave: "fattura_media", nome: "Valore medio per fattura" },
  ],
  [
    { chiave: "consegnato", nome: "Somma dei valori" },
    { chiave: "n_consegne", nome: "Numero di consegne" },
    { chiave: "consegna_media", nome: "Valore medio per consegna" },
  ],
  [
    { chiave: "preventivi_valore", nome: "Somma dei valori" },
    { chiave: "n_preventivi", nome: "Numero di preventivi" },
    { chiave: "valore_medio_preventivo", nome: "Valore medio per preventivo" },
  ],
];

/** Le altre letture dello stesso campo, se la metrica ne ha (include se stessa). */
export function alternativeDiCalcolo(chiave: ChiaveCampo): AlternativaCalcolo[] {
  if (eChiaveMisura(chiave)) return [];
  return FAMIGLIE_CALCOLO.find((famiglia) => famiglia.some((voce) => voce.chiave === chiave)) ?? [];
}

/** Il progressivo cumula: ha senso solo per somme e conteggi. */
export function ammetteProgressivo(chiave: ChiaveCampo, definizioni: Record<string, MisuraDefinita> = {}): boolean {
  if (eChiaveMisura(chiave)) return false;
  const natura = naturaDellaVoce(chiave, definizioni);
  return natura === "somma" || natura === "conteggio";
}

/**
 * Il testo da proporre a «Nuova misura a parole» per partire da una misura che
 * c'e' gia': chi vuole una variante (stesso calcolo, un solo cliente, una sola
 * business unit) non deve riscriverla da capo.
 */
export function testoPerPartireDa(etichetta: string, calcolo: string): string {
  return `Come «${etichetta}» (${calcolo.replace(/\.$/, "")}), ma `;
}
