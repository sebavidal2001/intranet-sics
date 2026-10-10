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

/**
 * Una voce dell'albero: un'operazione con i suoi valori, le sue misure
 * calcolate e i suoi campi.
 *
 * I VALORI sono somme e conteggi; le MISURE sono medie, rapporti e massimi, con
 * il calcolo scritto (`GRUPPI_MISURE`). Una metrica sta in una sola voce.
 */
export interface VoceAlbero extends GruppoOperazione {
  /** Le misure calcolate di questa voce: medie, tassi, percentuali. */
  misure?: ChiaveMetrica[];
}

/** Una cartella dell'albero: raccoglie le voci di un'area, come Vendite o Acquisti. */
export interface Cartella {
  chiave: string;
  etichetta: string;
  descrizione: string;
  voci: VoceAlbero[];
}

/** I campi per leggere un documento di vendita: numero, tipo, date di consegna, condizione. */
const CAMPI_DOCUMENTO_VENDITA = (etichettaNumero: string): CampoSuddivisione[] => [
  { chiave: "documento_anno", etichetta: etichettaNumero },
  { chiave: "profilo" },
  { chiave: "data_consegna_richiesta" },
  { chiave: "data_consegna_confermata" },
  { chiave: "condizione_pagamento" },
];

/**
 * L'albero in tre aree e qualche cartella di dati a parte.
 *
 * VENDITE e ACQUISTI seguono il ciclo del documento (ordinato, consegnato,
 * fatturato); PERSONALE guarda le persone e gli uffici; le altre cartelle
 * raccolgono dati che prima il builder non vedeva (magazzino, spedizioni,
 * anagrafica clienti).
 */
export const CARTELLE: Cartella[] = [
  {
    chiave: "vendite",
    etichetta: "Vendite",
    descrizione: "Ordini, consegne, fatture, portafoglio, banco, preventivi e budget.",
    voci: [
      {
        chiave: "ordinato",
        etichetta: "Ordinato",
        descrizione: "Gli ordini ricevuti dai clienti.",
        valori: ["ordinato", "n_ordini", "quantita_ordinata"],
        misure: ["ordine_medio"],
        campi: CAMPI_DOCUMENTO_VENDITA("Numero ordine/anno"),
        famiglieDocumento: ["ordinato"],
      },
      {
        chiave: "fatturato",
        etichetta: "Fatturato",
        descrizione: "Le fatture emesse, con costo, margine, incassi attesi e tempi di incasso.",
        valori: ["fatturato", "n_fatture", "quantita_fatturata", "costo_venduto", "margine", "incassi_attesi", "saldo_cassa"],
        misure: ["fattura_media", "margine_pct", "copertura_costi_pct", "giorni_incasso"],
        // «Incasso / pagamento» serve al saldo (incassi − pagamenti): divide i due versi.
        campi: [...CAMPI_DOCUMENTO_VENDITA("Numero fattura/anno"), { chiave: "tipo_scadenza" }],
        famiglieDocumento: ["fatturato", "scadenze", "pagamenti"],
      },
      {
        chiave: "consegnato",
        etichetta: "Consegnato",
        descrizione: "La merce uscita con i documenti di consegna.",
        valori: ["consegnato", "n_consegne", "quantita_consegnata"],
        misure: ["consegna_media"],
        campi: CAMPI_DOCUMENTO_VENDITA("Numero consegna/anno"),
        famiglieDocumento: ["consegnato"],
      },
      {
        chiave: "portafoglio",
        etichetta: "Portafoglio",
        descrizione:
          "Ordini acquisiti non ancora consegnati. Con le date di consegna richiesta e confermata puoi leggerlo per giorno, settimana, mese o anno di consegna.",
        // `consegnato_futuro` e' lo stesso portafoglio sul mese di consegna: resta nel motore
        // (lo usa il Cruscotto) ma non si offre due volte.
        valori: ["portafoglio"],
        campi: CAMPI_DOCUMENTO_VENDITA("Numero ordine/anno"),
        famiglieDocumento: ["portafoglio"],
      },
      {
        chiave: "banco",
        etichetta: "Banco",
        descrizione: "Vendite e movimenti gestiti al banco.",
        valori: ["banco"],
        campi: [
          { chiave: "documento_anno", etichetta: "Numero documento/anno" },
          { chiave: "profilo" },
          { chiave: "condizione_pagamento" },
        ],
        famiglieDocumento: ["controllo_banco"],
      },
      {
        chiave: "preventivi",
        etichetta: "Preventivi",
        descrizione: "Le offerte: valore, esito, causale, anzianità. Aperti sono i preventivi in corso (causale PIC).",
        valori: [
          "preventivi_valore",
          "preventivi_convertito",
          "n_preventivi",
          "preventivi_aperti",
          "preventivi_inevaso",
          "preventivi_aperti_oltre_90",
        ],
        misure: ["tasso_conversione", "valore_medio_preventivo", "giorni_apertura", "eta_massima_apertura"],
        campi: [
          { chiave: "documento_anno", etichetta: "Numero preventivo/anno" },
          { chiave: "profilo" },
          { chiave: "causale_codice", etichetta: "Codice causale (PIC, POR…)" },
          { chiave: "causale", etichetta: "Causale (descrizione)" },
          { chiave: "esito" },
          { chiave: "fascia_eta" },
          { chiave: "condizione_pagamento" },
        ],
        famiglieDocumento: ["preventivi_aperti"],
      },
      {
        chiave: "budget",
        etichetta: "Budget",
        descrizione: "Obiettivi commerciali e punto di pareggio.",
        valori: ["budget", "bep"],
        campi: [],
      },
    ],
  },
  {
    chiave: "acquisti",
    etichetta: "Acquisti",
    descrizione: "Ordini a fornitore, arrivi della merce, fatture e pagamenti dovuti.",
    voci: [
      {
        chiave: "acquisti_ordinato",
        etichetta: "Ordinato",
        descrizione: "Gli ordini a fornitore.",
        valori: ["acquisti_valore", "acquisti_quantita", "acquisti_ordini", "acquisti_righe"],
        // Il numero dell'ordine a fornitore porta gia' profilo e anno («OF 12/2026»).
        campi: [
          { chiave: "fornitore" },
          { chiave: "buyer" },
          { chiave: "documento", etichetta: "Numero ordine fornitore" },
          { chiave: "profilo", etichetta: "Profilo documento (tipo ordine)" },
          { chiave: "data_promessa" },
          { chiave: "condizione_pagamento" },
        ],
        famiglieDocumento: ["acquisti"],
      },
      {
        chiave: "acquisti_consegnato",
        etichetta: "Consegnato",
        descrizione: "Gli arrivi della merce (DDT del fornitore): puntualità, tempi di consegna, righe da sollecitare.",
        valori: ["acquisti_da_sollecitare", "acquisti_valore_da_sollecitare"],
        misure: ["puntualita_fornitori", "ritardo_medio_fornitori", "giorni_consegna_fornitori"],
        campi: [
          { chiave: "fornitore" },
          { chiave: "buyer" },
          { chiave: "documento", etichetta: "Numero ordine fornitore" },
          { chiave: "profilo", etichetta: "Profilo documento (tipo ordine)" },
          { chiave: "data_promessa" },
        ],
        famiglieDocumento: ["acquisti"],
      },
      {
        chiave: "acquisti_fatturato",
        etichetta: "Fatturato",
        descrizione:
          "Le fatture e le note di credito dei fornitori (le note tolgono), i pagamenti dovuti e i tempi di pagamento. Il legame con l'ordine c'è quando la fattura passa da un DDT d'acquisto.",
        valori: ["fatturato_fornitore", "n_fatture_fornitore", "pagamenti_dovuti"],
        misure: ["giorni_pagamento"],
        campi: [
          { chiave: "fornitore" },
          { chiave: "documento", etichetta: "Fattura (registrazione/anno)" },
          { chiave: "numero_fattura_fornitore" },
          { chiave: "profilo", etichetta: "Tipo documento" },
          { chiave: "condizione_pagamento" },
          { chiave: "profilo_ordine" },
        ],
        famiglieDocumento: ["fatture_fornitore", "scadenze", "pagamenti"],
      },
    ],
  },
  {
    chiave: "personale",
    etichetta: "Personale",
    descrizione: "Il lavoro di commerciali, ufficio acquisti e backoffice.",
    voci: [
      {
        chiave: "personale_commerciale",
        etichetta: "Commerciale (visite)",
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
        chiave: "personale_acquisti",
        etichetta: "Acquisti (ordini e fatture)",
        descrizione: "Il lavoro dell'ufficio acquisti: ordini a fornitore, DDT e fatture creati da ogni utente.",
        valori: ["documenti_acquisto_creati", "righe_acquisto_inserite"],
        campi: [
          { chiave: "creatore" },
          { chiave: "profilo", etichetta: "Tipo documento" },
          { chiave: "ora_creazione" },
          { chiave: "soggetto", etichetta: "Fornitore" },
          { chiave: "documento" },
        ],
        famiglieDocumento: ["documenti_utente"],
      },
      {
        chiave: "personale_backoffice",
        etichetta: "Backoffice (carico di lavoro)",
        descrizione:
          "Il carico di lavoro: preventivi, ordini, bolle e fatture creati da ogni utente, con i tempi di risposta sui preventivi. Alcuni utenti sono condivisi (vendite, segreteria): ruoli, non persone.",
        valori: ["preventivi_creati", "righe_preventivo", "documenti_vendita_creati", "righe_vendita_inserite"],
        misure: ["giorni_risposta", "quota_stesso_giorno"],
        campi: [
          { chiave: "creatore" },
          { chiave: "profilo", etichetta: "Tipo documento" },
          { chiave: "ora_creazione" },
          { chiave: "soggetto", etichetta: "Cliente" },
          { chiave: "documento" },
        ],
        famiglieDocumento: ["documenti_utente"],
      },
    ],
  },
  {
    chiave: "magazzino",
    etichetta: "Magazzino e articoli",
    descrizione: "Giacenze, impegni e ordinato per articolo e magazzino; variazioni di costo.",
    voci: [
      {
        chiave: "articoli",
        etichetta: "Giacenze e impegni",
        descrizione:
          "Fotografia dell'ultimo caricamento: esistenza, disponibilità, ordinato da clienti e a fornitori, impegni di produzione, valore della giacenza. Il tempo non ha senso; il periodo deve contenere oggi.",
        valori: [
          "articoli_numero",
          "articoli_esistenza",
          "articoli_disponibilita",
          "articoli_qta_ord_clienti",
          "articoli_qta_ord_fornitori",
          "articoli_qta_imp_produzione",
          "articoli_qta_ord_produzione",
          "articoli_valore_giacenza",
        ],
        misure: ["articoli_ultimo_costo"],
        campi: [{ chiave: "magazzino" }, { chiave: "reparto" }, { chiave: "fornitore" }],
      },
      {
        chiave: "variazioni_costo",
        etichetta: "Variazioni di costo",
        descrizione: "Quando e di quanto cambia l'ultimo costo di acquisto degli articoli.",
        valori: ["variazioni_costo_numero"],
        misure: ["variazioni_costo_pct_media"],
        campi: [],
      },
    ],
  },
  {
    chiave: "logistica",
    etichetta: "Logistica",
    descrizione: "I documenti di trasporto: vettore, colli, peso, destinazione.",
    voci: [
      {
        chiave: "spedizioni",
        etichetta: "Spedizioni",
        descrizione: "DDT di vendita (merce in uscita) e di acquisto (merce in entrata).",
        valori: [
          "spedizioni_numero",
          "spedizioni_colli",
          "spedizioni_pallet",
          "spedizioni_peso_lordo",
          "spedizioni_volume",
          "spedizioni_spese",
        ],
        campi: [
          { chiave: "vettore" },
          { chiave: "direzione_merce" },
          { chiave: "tipo_trasporto" },
          { chiave: "causale_trasporto" },
          { chiave: "provincia_destinazione" },
          { chiave: "zona_spedizione" },
          { chiave: "mezzo_trasporto" },
          { chiave: "soggetto", etichetta: "Cliente / fornitore" },
          { chiave: "profilo", etichetta: "Tipo documento" },
          { chiave: "documento", etichetta: "Numero documento" },
        ],
        famiglieDocumento: ["spedizioni"],
      },
    ],
  },
  {
    chiave: "anagrafiche",
    etichetta: "Clienti",
    descrizione: "L'anagrafica dei clienti.",
    voci: [
      {
        chiave: "clienti",
        etichetta: "Anagrafica clienti",
        descrizione: "Quanti clienti, di che categoria, in che zona, con quale agente. Con il tempo: i clienti nuovi.",
        valori: ["clienti_numero"],
        campi: [
          { chiave: "cliente_attivo" },
          { chiave: "provincia" },
          { chiave: "cap" },
        ],
      },
    ],
  },
];

/**
 * Le voci in elenco piatto: per chi non guarda le cartelle (i menu dei pozzetti,
 * i controlli di completezza). L'ordine e' quello dell'albero.
 */
export const GRUPPI_OPERAZIONI: GruppoOperazione[] = CARTELLE.flatMap((cartella) => cartella.voci);

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
    descrizione: "Chi compra e chi vende, con la categoria, la zona e il tipo del cliente.",
    dimensioni: [
      "cliente",
      "codice_cliente",
      "agente",
      "codice_agente",
      "categoria_attivita",
      "categoria_commerciale",
      "zona_cliente",
      "tipo_cliente",
    ],
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
    chiave: "articoli",
    etichetta: "Magazzino e articoli",
    misure: [
      {
        chiave: "articoli_ultimo_costo",
        calcolo: "Media dell'ultimo costo di acquisto delle righe articolo-magazzino che hanno un costo noto.",
      },
      {
        chiave: "variazioni_costo_pct_media",
        calcolo: "Media delle variazioni percentuali dell'ultimo costo: positiva se i costi salgono.",
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
        chiave: "ritardo_medio_fornitori",
        calcolo: "Media dei giorni di ritardo sulla data promessa, sulle sole righe arrivate in ritardo.",
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
