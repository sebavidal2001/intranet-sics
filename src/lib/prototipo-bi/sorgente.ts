/**
 *
 * Sorgente dati: legge IN SOLA LETTURA le viste `public.bi_*` già esistenti
 * (le stesse che Power BI legge oggi) e ne costruisce uno snapshot locale.
 *
 * Perché uno snapshot e non query dirette:
 *  - le viste filtrano già sul run corrente, quindi pesano poco
 *    (~66.000 righe in tutto, non 1,8 milioni);
 *  - PostgREST ha gli aggregati disabilitati su questo progetto, quindi
 *    l'aggregazione va fatta comunque fuori dal database;
 *  - così il prototipo funziona anche offline e non carica la produzione.
 *
 * NESSUNA SCRITTURA sul database. Mai.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { salvaSnapshotInCache, leggiSnapshotDaCache, etaSnapshot } from "./archivio";
import { etichettaBusinessUnit, controllaTassonomia } from "./business-unit";
import type { ChiaveDataset, RigaFatto, Snapshot } from "./tipi";

/** Viste di origine. `importoCampo` cambia solo per i preventivi. */
const VISTE: Record<ChiaveDataset, { vista: string; importoCampo: string }> = {
  ordinato: { vista: "bi_ordinato", importoCampo: "Importo" },
  fatturato: { vista: "bi_fatturato", importoCampo: "Importo" },
  consegnato: { vista: "bi_consegnato", importoCampo: "Importo" },
  portafoglio: { vista: "bi_portafoglio", importoCampo: "Importo" },
  // I preventivi passano da una vista dedicata, che aggiunge i campi back
  // office: vedere `scaricaPreventivi`.
  preventivi_aperti: {
    vista: "bi_preventivi_backoffice",
    importoCampo: "Importo Inevaso",
  },
  controllo_banco: { vista: "bi_controllo_banco", importoCampo: "Importo" },
  consegnato_futuro_per_mese: {
    vista: "bi_consegnato_futuro_per_mese",
    importoCampo: "Importo",
  },
};

// PostgREST limita ogni risposta a 1000 righe: verificato chiedendone 5.000 e
// 20.000, torna sempre 1.000. L'unico modo per andare piu' veloce e' chiedere
// piu' pagine insieme.
const PAGINA = 1000;

type RigaGrezza = Record<string, unknown>;

// Quante richieste tenere in volo IN TOTALE, non per dataset.
//
// Misurato su bi_consegnato (18.000 righe, 18 pagine):
//   sequenziale  6.766 ms · 3 in parallelo 1.984 ms
//   6 in parallelo 919 ms · 12 in parallelo 744 ms
//
// Il limite deve pero' essere globale: i 7 dataset partono insieme, e con un
// limite per-dataset si arrivava a 56 richieste contemporanee: il tempo totale
// PEGGIORAVA (5,4 s contro i 4,4 s della versione sequenziale) perche' le
// richieste si facevano concorrenza a vicenda.
const PARALLELE = 10;

/** Semaforo: limita quante promesse girano insieme in tutto il processo. */
class Semaforo {
  private attivi = 0;
  private coda: (() => void)[] = [];

  constructor(private readonly massimo: number) {}

  async esegui<T>(fn: () => Promise<T>): Promise<T> {
    if (this.attivi >= this.massimo) {
      await new Promise<void>((risolvi) => this.coda.push(risolvi));
    }
    this.attivi += 1;
    try {
      return await fn();
    } finally {
      this.attivi -= 1;
      this.coda.shift()?.();
    }
  }
}

const semaforo = new Semaforo(PARALLELE);

/**
 * Scarica una tabella o vista a pagine, chiedendole in parallelo entro il
 * limite globale.
 *
 * Prima si conta, poi si chiedono tutte le pagine insieme: senza il conteggio
 * non si sa quante pagine servono e si torna per forza sequenziali.
 */
async function scaricaPaginato<T>(tabella: string): Promise<T[]> {
  const sb = createAdminClient();

  const conteggio = await semaforo.esegui(async () =>
    sb.from(tabella).select("*", { count: "exact", head: true })
  );
  if (conteggio.error) throw new Error(`Conteggio ${tabella}: ${conteggio.error.message}`);
  const totale = conteggio.count ?? 0;
  if (totale === 0) return [];

  // Cintura di sicurezza: le viste correnti stanno sotto le 20.000 righe.
  const pagine = Math.min(Math.ceil(totale / PAGINA), 200);

  const blocchi = await Promise.all(
    Array.from({ length: pagine }, (_, i) =>
      semaforo.esegui(async () => {
        const { data, error } = await sb
          .from(tabella)
          .select("*")
          .range(i * PAGINA, i * PAGINA + PAGINA - 1);
        if (error) throw new Error(`Lettura ${tabella} pagina ${i}: ${error.message}`);
        return (data ?? []) as T[];
      })
    )
  );

  return blocchi.flat();
}

function testo(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function numero(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function soloData(v: unknown): string {
  const t = testo(v);
  if (!t) return "";
  return t.slice(0, 10);
}

function normalizza(riga: RigaGrezza, importoCampo: string): RigaFatto {
  return {
    data: soloData(riga["Data Documento"]),
    importo: numero(riga[importoCampo]),
    // Le viste hanno gia applicato la partizione SISTEMI -> COSTRUITO/STRUTTURE:
    // qui si traduce solo il "-" del gestionale in un'etichetta leggibile.
    bu: etichettaBusinessUnit(testo(riga["Gruppo Descrizione"])),
    categoria: testo(riga["Categoria Descrizione"]),
    agente: testo(riga["Agente"]) || "(senza agente)",
    codiceAgente: testo(riga["Codice Agente"]),
    cliente: testo(riga["Nome Cliente"]) || "(senza cliente)",
    codiceCliente: testo(riga["Codice Cliente"]),
    documento: testo(riga["Numero Doc."]),
    articolo: testo(riga["Codice Articolo"]),
    descrizioneArticolo: testo(riga["Descrizione articolo"]),
    quantita: numero(riga["Quantità"]),
    causaleCodice: testo(riga["Causale Magazzino Codice"]) || undefined,
    causaleDescrizione: testo(riga["Causale Magazzino Descrizione"]) || undefined,
    rigaEvasa: testo(riga["Riga evasa"]) || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preventivi: lettura arricchita
//
// La vista storica `bi_preventivi_aperti` non espone i campi back office
// (utente creatore, data creazione, data richiesta cliente) e lo schema
// `powerbi` non e' raggiungibile via PostgREST. Per un periodo il prototipo
// leggeva quindi la tabella grezza, con due conseguenze sgradevoli: doveva
// filtrare a mano sul run corrente, e soprattutto si perdeva la
// riconciliazione delle business unit fatta dalle viste, che era stata
// riscritta in TypeScript creando un doppione.
//
// Ora esiste `public.bi_preventivi_backoffice` (vedere
// prototipo-bi/sql/002_vista_preventivi_backoffice.sql), che espone i campi
// back office E applica la stessa regola delle altre viste. Il TypeScript non
// conosce piu' ne' la partizione delle business unit, ne' il calcolo dei
// giorni di risposta, ne' la formula del convertito: stanno tutti nel database,
// scritti una volta sola.
// ─────────────────────────────────────────────────────────────────────────────

async function scaricaPreventivi(): Promise<RigaFatto[]> {
  const grezze = await scaricaPaginato<RigaGrezza>("bi_preventivi_backoffice");

  return grezze.map((g) => {
    const gg = g["Giorni Risposta"];
    return {
      ...normalizza(g, "Importo Inevaso"),
      valoreTotale: numero(g["Valore Totale Riga"]),
      convertito: numero(g["Convertito In Ordine"]),
      evasa: testo(g["Riga evasa"]) === "S",
      creatore: testo(g["Creato da"]) || "(non indicato)",
      dataCreazione: testo(g["Data Creazione"]) || undefined,
      dataRichiesta: testo(g["Data Richiesta Cliente"]) || undefined,
      // La vista restituisce NULL quando la data e' assente o incoerente:
      // si conserva la distinzione fra "zero giorni" e "non calcolabile".
      giorniRisposta: gg === null || gg === undefined ? null : numero(gg),
    };
  });
}

async function scaricaVista(
  vista: string,
  importoCampo: string
): Promise<RigaFatto[]> {
  const grezze = await scaricaPaginato<RigaGrezza>(vista);
  return grezze.map((r) => normalizza(r, importoCampo));
}

// ─────────────────────────────────────────────────────────────────────────────
// Costi di acquisto — il costo VALIDO ALLA DATA DI VENDITA
//
// Il gestionale tiene il listino dei costi versionato per data dal 1999
// (`dba.listino` 331 -> `dba.variazione.data_inizio` -> `dba.prezzo`). Lo
// storico arriva qui nella tabella `bi.costi_listino_storico` e si legge dalla
// vista `public.bi_costi_listino_storico` — lo schema `bi` non e' esposto da
// PostgREST, e una query su schema non esposto torna VUOTA SENZA ERRORE.
//
// Per ogni riga di vendita si prende il costo della variazione piu' recente
// fra quelle con `valido_dal <= data del documento`. Copertura misurata sul
// 2025: 97,9% del valore, margine 35,40% — lo stesso numero che da' il
// gestionale. Referto: docs/bi/REFERTO-costo-alla-vendita-20260917.md
//
// Che cosa NON e' (e va detto a chi legge il numero): e' il costo a cui quel
// giorno si sarebbe RICOMPRATA la merce, non il costo dei pezzi effettivamente
// venduti. Il listino UC e' l'ultimo prezzo pagato, senza legame col lotto a
// scaffale: se compro a 10, l'UC passa a 12 e vendo i pezzi comprati a 10,
// viene registrato 12. Il costo vero non e' ricuperabile — magazzino non
// valorizzato, lotti non usati. E' un margine a costo di ricostituzione, non
// un COGS contabile.
//
// Il ripiego su `preventivatore.prodotti` (ultimo costo noto, uno per
// articolo) resta per il caso in cui lo storico non ci sia: meglio un margine
// dichiarato approssimativo che nessun margine. Ma non deve MAI cambiare
// significato in silenzio, quindi `costiApprossimati` finisce negli avvisi.
// ─────────────────────────────────────────────────────────────────────────────

/** Una variazione di costo: da quella data in poi, quel costo. */
interface VoceCosto {
  dal: string; // ISO yyyy-mm-dd
  costo: number;
}

export interface StoricoCosti {
  /** Per articolo, le variazioni ordinate dalla piu' recente alla piu' vecchia. */
  serie: Map<string, VoceCosto[]>;
  /** Vero se si e' ripiegato sull'ultimo costo noto invece dello storico. */
  approssimati: boolean;
}

/**
 * Costo valido a una data: la prima voce con `dal <= data`.
 *
 * Le voci sono ordinate dalla piu' recente alla piu' vecchia, quindi si cerca
 * per bisezione il primo elemento che non sia nel futuro rispetto alla
 * vendita. Con 82.000 voci e 66.000 righe da risolvere, la scansione lineare
 * costerebbe un paio di ordini di grandezza in piu'.
 *
 * Ritorna `null` se l'articolo non ha nessun costo precedente alla vendita:
 * "non lo so", che e' diverso da "vale zero". Un costo zero darebbe margine
 * 100% su quella riga.
 */
export function costoAllaData(voci: VoceCosto[] | undefined, data: string): VoceCosto | null {
  if (!voci || voci.length === 0 || !data) return null;
  let basso = 0;
  let alto = voci.length - 1;
  let trovato: VoceCosto | null = null;
  while (basso <= alto) {
    const mezzo = (basso + alto) >> 1;
    if (voci[mezzo].dal <= data) {
      trovato = voci[mezzo];
      alto = mezzo - 1; // piu' recente fra quelle valide: continua a sinistra
    } else {
      basso = mezzo + 1;
    }
  }
  return trovato;
}

async function caricaStoricoCosti(): Promise<StoricoCosti> {
  const serie = new Map<string, VoceCosto[]>();
  try {
    const righe = await scaricaPaginato<RigaGrezza>("bi_costi_listino_storico");
    for (const riga of righe) {
      const codice = chiaveArticolo(riga["codice_articolo"]);
      const dal = soloData(riga["valido_dal"]);
      const costo = numero(riga["costo"]);
      // Zero e negativo non sono costi: sono campi non compilati.
      if (!codice || !dal || !(costo > 0)) continue;
      const voci = serie.get(codice);
      if (voci) voci.push({ dal, costo });
      else serie.set(codice, [{ dal, costo }]);
    }
    if (serie.size > 0) {
      // Dalla piu' recente alla piu' vecchia: e' l'ordine che serve a
      // `costoAllaData`. La vista non garantisce un ordinamento.
      for (const voci of serie.values()) voci.sort((a, b) => (a.dal < b.dal ? 1 : a.dal > b.dal ? -1 : 0));
      return { serie, approssimati: false };
    }
    // Vista vuota: non e' un errore, ma non e' nemmeno uno storico.
    console.warn("[BI] storico costi vuoto: ripiego sull'ultimo costo noto");
  } catch (e) {
    console.warn("[BI] storico costi non caricato:", e instanceof Error ? e.message : e);
  }
  return caricaUltimoCostoNoto();
}

/**
 * Ripiego: `preventivatore.prodotti.ult_costo`, un costo per articolo, quello
 * corrente. Si presenta come uno storico di una voce sola con data d'inizio
 * all'origine dei tempi, cosi' la risoluzione per riga resta identica.
 */
async function caricaUltimoCostoNoto(): Promise<StoricoCosti> {
  const serie = new Map<string, VoceCosto[]>();
  try {
    const sb = createAdminClient().schema("preventivatore");
    const conteggio = await semaforo.esegui(async () =>
      sb.from("prodotti").select("*", { count: "exact", head: true })
    );
    if (conteggio.error) throw new Error(conteggio.error.message);
    const totale = conteggio.count ?? 0;
    if (totale === 0) return { serie, approssimati: true };

    const pagine = Math.min(Math.ceil(totale / PAGINA), 200);
    const blocchi = await Promise.all(
      Array.from({ length: pagine }, (_, i) =>
        semaforo.esegui(async () => {
          const { data, error } = await sb
            .from("prodotti")
            .select("codice,ult_costo,data_ult_costo")
            .range(i * PAGINA, i * PAGINA + PAGINA - 1);
          if (error) throw new Error(error.message);
          return (data ?? []) as RigaGrezza[];
        })
      )
    );

    for (const riga of blocchi.flat()) {
      const codice = chiaveArticolo(riga["codice"]);
      if (!codice) continue;
      const grezzo = riga["ult_costo"];
      if (grezzo === null || grezzo === undefined || grezzo === "") continue;
      const costo = numero(grezzo);
      if (!(costo > 0)) continue;
      // Data all'origine dei tempi: questo costo vale per qualunque vendita,
      // che e' esattamente il difetto del ripiego, dichiarato negli avvisi.
      serie.set(codice, [{ dal: "0000-01-01", costo }]);
    }
  } catch (e) {
    // Il costo e' un arricchimento: se manca, le metriche di margine lo dicono
    // e tutto il resto dello snapshot resta valido. Non vale un errore fatale.
    console.warn("[BI] ultimo costo noto non caricato:", e instanceof Error ? e.message : e);
  }
  return { serie, approssimati: true };
}

/** I codici articolo nel gestionale hanno spazi e maiuscole incoerenti. */
function chiaveArticolo(v: unknown): string {
  return testo(v).toUpperCase();
}

async function leggiStatoRun(): Promise<{
  runCorrente: string | null;
  ricevutoIl: string | null;
}> {
  try {
    const sb = createAdminClient();
    const { data } = await sb
      .from("bi_runs")
      .select("run_id, received_at, status")
      .eq("status", "current")
      .limit(1);
    const r = data?.[0] as { run_id?: string; received_at?: string } | undefined;
    return {
      runCorrente: r?.run_id ?? null,
      ricevutoIl: r?.received_at ?? null,
    };
  } catch {
    return { runCorrente: null, ricevutoIl: null };
  }
}

/** Costruisce uno snapshot fresco leggendo tutte le viste. */
export async function costruisciSnapshot(): Promise<Snapshot> {
  const stato = await leggiStatoRun();

  const chiavi = Object.keys(VISTE) as ChiaveDataset[];
  const risultati = await Promise.all(
    chiavi.map(async (k) => {
      // I preventivi passano dalla tabella grezza per avere i campi
      // back office; tutto il resto legge le viste, che filtrano già il run.
      if (k === "preventivi_aperti") {
        return [k, await scaricaPreventivi()] as const;
      }
      const { vista, importoCampo } = VISTE[k];
      return [k, await scaricaVista(vista, importoCampo)] as const;
    })
  );

  const dataset = Object.fromEntries(risultati) as Record<ChiaveDataset, RigaFatto[]>;

  // Il costo si aggancia a ogni riga che ha un articolo, prendendo la
  // variazione valida ALLA DATA DEL DOCUMENTO. Le righe senza corrispondenza
  // restano con `costoUnitario: null` e le metriche di margine le escludono:
  // e' la differenza fra "non lo so" e "vale zero".
  const costi = await caricaStoricoCosti();
  for (const righe of Object.values(dataset)) {
    for (const r of righe) {
      const voce = r.articolo
        ? costoAllaData(costi.serie.get(chiaveArticolo(r.articolo)), r.data)
        : null;
      r.costoUnitario = voce ? voce.costo : null;
      // La data della versione APPLICATA, non l'ultima nota: e' cio' che
      // permette di dire quanto era fresco il costo al momento della vendita.
      r.dataCosto = voce ? (voce.dal === "0000-01-01" ? null : voce.dal) : null;
    }
  }

  // Sentinella: se il gestionale introduce un gruppo o una categoria nuova,
  // meglio saperlo subito che ritrovarsi una fetta in piu' nei grafici.
  const tassonomia = controllaTassonomia(
    Object.values(dataset).flatMap((righe) => righe.map((r) => r.bu))
  );
  const conteggi = Object.fromEntries(
    risultati.map(([k, v]) => [k, v.length])
  ) as Record<string, number>;

  // La data di riferimento ("oggi") deve venire SOLO dai dataset che guardano
  // al passato. `portafoglio` e `consegnato_futuro_per_mese` contengono
  // consegne previste fino al 2027-03-31: includerli farebbe credere al
  // sistema di essere a marzo 2027, con tre effetti a catena — briefing datato
  // al futuro, rilevatore di budget spento (anno diverso da quello
  // configurato) e clienti classificati dormienti per sette mesi inesistenti.
  const DATASET_STORICI: ChiaveDataset[] = [
    "ordinato",
    "fatturato",
    "consegnato",
    "controllo_banco",
    "preventivi_aperti",
  ];

  const dateStoriche = risultati
    .filter(([k]) => DATASET_STORICI.includes(k))
    .flatMap(([, righe]) => righe.map((r) => r.data))
    .filter(Boolean)
    .sort();

  const tutteLeDate = risultati
    .flatMap(([, righe]) => righe.map((r) => r.data))
    .filter(Boolean)
    .sort();

  // Anzianità dei preventivi ancora aperti: si calcola qui perché serve la
  // data di riferimento dei dati, nota solo dopo aver letto tutto. Usare
  // `new Date()` farebbe cambiare i numeri fra un'apertura e l'altra della
  // pagina anche senza un nuovo caricamento dati.
  const riferimento = dateStoriche[dateStoriche.length - 1] ?? null;
  if (riferimento) {
    const rif = Date.parse(`${riferimento}T00:00:00Z`);
    for (const r of dataset.preventivi_aperti) {
      // Una riga interamente convertita non è "aperta da" nessun tempo.
      const aperta = r.importo > 0.01;
      if (!aperta || !r.data) {
        r.giorniAperto = null;
        continue;
      }
      const d = Date.parse(`${r.data}T00:00:00Z`);
      const giorni = Math.round((rif - d) / 86_400_000);
      r.giorniAperto = giorni >= 0 ? giorni : null;
    }
  }


  return {
    generatoIl: new Date().toISOString(),
    runCorrente: stato.runCorrente,
    runRicevutoIl: stato.ricevutoIl,
    tassonomiaBu: tassonomia,
    dataMinima: dateStoriche[0] ?? tutteLeDate[0] ?? null,
    dataMassima: dateStoriche[dateStoriche.length - 1] ?? null,
    dataMassimaAssoluta: tutteLeDate[tutteLeDate.length - 1] ?? null,
    dataset,
    conteggi,
    versioneForma: VERSIONE_FORMA,
    costiApprossimati: costi.approssimati,
  };
}

/**
 * Forma dello snapshot serializzato.
 *
 * Da incrementare quando si aggiungono campi alle righe: un file di cache
 * scritto prima non li ha, e un campo assente non e' un errore visibile —
 * diventa una metrica che risponde zero. E' successo col costo: senza questo
 * numero, per sei ore dopo il deploy il margine sarebbe stato vuoto senza che
 * niente fosse rotto.
 *
 * 3 (17/09/2026): `costoUnitario` passa dall'ULTIMO costo noto al costo valido
 * alla data di vendita. Qui il campo non cambia forma ma cambia SIGNIFICATO, e
 * il pericolo e' lo stesso: senza incremento, per sei ore dopo il deploy la
 * cache servirebbe i vecchi costi correnti spacciandoli per storici, senza
 * dare errore.
 */
const VERSIONE_FORMA = 3;

// Cache in memoria per la durata del processo: evita di rileggere il file
// JSON ad ogni richiesta durante una sessione di lavoro.
//
// `inMemoriaIl` non e' un dettaglio: senza, la copia in memoria non scadeva
// MAI. Il file aveva sei ore di validita', ma il file veniva riletto solo
// quando `inMemoria` era vuota — cioe' solo subito dopo un riavvio. Sotto pm2
// il processo vive per giorni, quindi il primo snapshot costruito restava in
// servizio per sempre. Il 17/09/2026 il cruscotto scriveva "Dati aggiornati
// al 11/09": lo snapshot era stato costruito il 14/09 alle 19:28 e da allora
// nessuna richiesta aveva piu' guardato ne' il file ne' il database, mentre
// l'ingest notturno da SRVWOA continuava a lavorare regolarmente.
let inMemoria: Snapshot | null = null;
let inMemoriaIl = 0;

const SCADENZA_MS = 6 * 60 * 60 * 1000; // 6 ore

// Ogni quanto ci si chiede se e' arrivato un caricamento nuovo. E' una sola
// riga da `bi_runs`, non lo snapshot: costa quanto un ping. Serve perche' sei
// ore sono la misura giusta per il costo di ricostruzione e quella sbagliata
// per chi apre il BI la mattina dopo l'ingest dell'01:31 e vuole vedere ieri.
const CONTROLLO_RUN_MS = 10 * 60 * 1000; // 10 minuti
let controllatoIl = 0;

/**
 * Vero se il run pubblicato e' diverso da quello dello snapshot in mano.
 *
 * In caso di dubbio risponde `false`: se il database non risponde, o non dice
 * quale sia il run corrente, si tiene lo snapshot che c'e'. Rispondere `true`
 * su un errore trasformerebbe un'indisponibilita' momentanea in una raffica di
 * ricostruzioni da 66.000 righe.
 */
async function runCambiato(snapshot: Snapshot): Promise<boolean> {
  const stato = await leggiStatoRun();
  if (!stato.runCorrente || !snapshot.runCorrente) return false;
  return stato.runCorrente !== snapshot.runCorrente;
}

// Ricostruzione in corso. Dieci richieste che arrivano insieme su uno snapshot
// scaduto devono aspettare la stessa ricostruzione, non farne dieci.
let inCorso: Promise<Snapshot> | null = null;

/**
 * Restituisce lo snapshot, ricostruendolo se manca o è scaduto.
 * `forza` ignora la cache e rilegge dal database.
 */
export async function ottieniSnapshot(forza = false): Promise<Snapshot> {
  // Il file su disco e' una scorciatoia valida solo finche' descrive lo stesso
  // caricamento che abbiamo in mano: se e' arrivato un run nuovo va saltato,
  // altrimenti si sostituisce un dato vecchio con lo stesso dato vecchio.
  let ignoraFile = forza;

  if (!forza && inMemoria) {
    const adesso = Date.now();
    if (adesso - inMemoriaIl < SCADENZA_MS) {
      if (adesso - controllatoIl < CONTROLLO_RUN_MS) return inMemoria;
      controllatoIl = adesso;
      if (!(await runCambiato(inMemoria))) return inMemoria;
      ignoraFile = true;
    }
  }

  if (!forza && inCorso) return inCorso;

  const lavoro = (async () => {
    if (!ignoraFile) {
      const eta = await etaSnapshot();
      if (eta !== null && eta < SCADENZA_MS) {
        const daFile = await leggiSnapshotDaCache<Snapshot>();
        if (daFile && daFile.versioneForma === VERSIONE_FORMA) {
          inMemoria = daFile;
          // L'eta' e' quella del file: uno snapshot scritto cinque ore fa da un
          // altro processo ha un'ora di vita davanti, non sei.
          inMemoriaIl = Date.now() - eta;
          // Azzerato apposta: il file puo' venire da un run precedente, quindi
          // la prossima richiesta deve poter chiedere subito se e' cambiato.
          controllatoIl = 0;
          return daFile;
        }
      }
    }

    const fresco = await costruisciSnapshot();
    await salvaSnapshotInCache(fresco);
    inMemoria = fresco;
    inMemoriaIl = Date.now();
    controllatoIl = Date.now();
    return fresco;
  })();

  inCorso = lavoro;
  try {
    return await lavoro;
  } finally {
    if (inCorso === lavoro) inCorso = null;
  }
}

/** Svuota la cache in memoria (usato dopo un aggiornamento forzato). */
export function invalidaCacheMemoria() {
  inMemoria = null;
  inMemoriaIl = 0;
  controllatoIl = 0;
}
