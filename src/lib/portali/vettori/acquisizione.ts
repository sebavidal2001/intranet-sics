import { createAdminClient } from "@/lib/supabase/admin";
import { sincronizzaSpedizioniGestionali } from "./bolle";
import {
  abbina,
  raggruppaInSpedizioni,
  type BollaGestionale,
  type EsitoAbbinamento,
  type SpedizioneLogica,
} from "./abbinamento";
import { calcolaCostoAtteso, classifica, SOGLIE_DEFAULT } from "./calcolo";
import { descriviListino, risolviListino } from "./listino-service";
import type { FatturaLetta, RigaFattura } from "./fatture/tipi";
import type { CostoAtteso } from "./tipi";
import { righeConOneri } from "./confronto-fattura";
import { datiFisici, type MisuraBolla, type MisuraRiga } from "./misure";
import { valutaOversizedGls } from "./oversized";
import type { Rilevazione } from "./letture";

/**
 * Dalla fattura letta al payload di acquisizione.
 *
 * Mette insieme i tre pezzi già collaudati singolarmente — lettura della
 * fattura, aggancio alle bolle, calcolo del costo atteso — e produce **un solo
 * oggetto** che la RPC `vettori.acquisisci_fattura` scrive in una transazione.
 *
 * Costruire il payload qui e non nella route serve a una cosa sola: poterlo
 * guardare prima di salvarlo. La schermata di acquisizione mostra esattamente
 * questo, e il salvataggio è la stessa cosa con un `commit` in fondo.
 */

/** Quanti giorni prima e dopo il periodo di fattura cercare le bolle. */
const GIORNI_MARGINE = 45;

export interface RigaAcquisita {
  riga_numero: number;
  data: string | null;
  numero_spedizione: string | null;
  riferimento: string | null;
  riferimento_norm: string | null;
  controparte: string | null;
  direzione: string | null;
  colli: number | null;
  peso: number | null;
  peso_volumetrico: number | null;
  peso_tassato: number | null;
  nolo: number | null;
  supplementi: number;
  adeguamento: number;
  carburante: number;
  totale: number | null;
  dettaglio: Record<string, unknown>;
  confermata: boolean;
  spedizione_chiave: string | null;
  abbinamento: "numero" | "assistito" | "nessuno";
  motivo_abbinamento: string;
  candidati: SpedizioneLogica[];
  controllo: ControlloAcquisito | null;
  anomalie: AnomaliaAcquisita[];
}

export interface ControlloAcquisito {
  listino_id: string | null;
  listino_etichetta: string | null;
  zona_codice: string | null;
  perc_adeguamento: number | null;
  perc_carburante: number | null;
  peso_reale: number | null;
  peso_volumetrico: number | null;
  peso_tassabile: number | null;
  peso_applicato: string | null;
  atteso_nolo: number;
  atteso_imponibile: number;
  atteso_adeguamento: number;
  atteso_carburante: number;
  atteso_fuori_base: number;
  atteso_totale: number;
  atteso_dettaglio: CostoAtteso["supplementi"];
  scostamento: number | null;
  esito: string;
  avvertenze: string[];
}

export interface AnomaliaAcquisita {
  tipo: string;
  gravita: "da_verificare" | "anomalia" | "informativa";
  descrizione: string;
  importo: number | null;
}

export interface PayloadAcquisizione {
  vettore_codice: string;
  numero: string | null;
  data_fattura: string | null;
  anno: number | null;
  mese: number | null;
  nome_file: string | null;
  hash_file: string | null;
  metodo_lettura: "testo" | "ocr" | "modello" | "manuale";
  quadratura_ok: boolean;
  quadratura_note: string | null;
  utente_id: string | null;
  totali: FatturaLetta["totali"];
  spedizioni: SpedizioneLogica[];
  righe: RigaAcquisita[];
}

export interface RiepilogoAcquisizione {
  righe: number;
  agganciate: number;
  daConfermare: number;
  senzaCandidati: number;
  inLinea: number;
  daVerificare: number;
  anomalie: number;
  nonValutabili: number;
  totaleFatturato: number;
  totaleAtteso: number;
  differenza: number;
}

export interface EstremiFattura {
  numero: string | null;
  data: string | null;
  origine: {
    numero: "documento" | "operatore" | "assente";
    data: "documento" | "operatore" | "assente";
  };
}

/**
 * Completa gli estremi senza permettere a un dato manuale di sostituire quello
 * letto. Nelle otto fatture GLS reali del 2026 tutte le 414 righe quadrano, ma
 * numero e data non esistono nel PDF: l'intervento dell'operatore serve solo a
 * colmare quell'assenza, non a correggere silenziosamente il documento.
 */
export function risolviEstremiFattura(
  fattura: Pick<FatturaLetta, "numero" | "data">,
  operatore: { numero?: string; data?: string } = {}
): EstremiFattura {
  const numeroOperatore = operatore.numero?.trim() || null;
  const dataOperatore = operatore.data?.trim() || null;

  return {
    numero: fattura.numero ?? numeroOperatore,
    data: fattura.data ?? dataOperatore,
    origine: {
      numero: fattura.numero
        ? "documento"
        : numeroOperatore
          ? "operatore"
          : "assente",
      data: fattura.data ? "documento" : dataOperatore ? "operatore" : "assente",
    },
  };
}

export function erroreEstremiMancanti(
  vettore: string,
  estremi: Pick<EstremiFattura, "numero" | "data">
): string | null {
  if (estremi.numero && estremi.data) return null;
  return vettore === "gls"
    ? "GLS non espone numero e data nel dettaglio spedizioni: vanno indicati a mano."
    : "Numero e data della fattura non sono presenti nel documento: vanno indicati a mano.";
}

function giorni(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Le bolle del periodo, dalla tabella di atterraggio della pipeline.
 *
 * Il margine di 45 giorni non è prudenza generica: la fattura di luglio
 * contiene spedizioni partite il 26 giugno, e una bolla può essere registrata
 * qualche giorno dopo il trasporto. Restringere al mese solare farebbe
 * risultare «senza bolla» spedizioni che la bolla ce l'hanno.
 */
export async function caricaBolle(
  daISO: string,
  aISO: string
): Promise<BollaGestionale[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("bi")
    .from("trasporti_documenti")
    .select(
      "id_documento, codice_profilo, tipo_registro, numero_progressivo, numero_documento, " +
        "data_documento, data_registrazione, id_sog_commerciale, codice_soggetto, soggetto, " +
        "zona_cap, zona_provincia, fonte_zona, tipo_trasporto_codice, tipo_trasporto, " +
        "tras_mezzo, vettore_codice, vettore, num_colli, peso_netto, peso_lordo, volume"
    )
    .gte("data_documento", giorni(daISO, -GIORNI_MARGINE))
    .lte("data_documento", giorni(aISO, GIORNI_MARGINE))
    .limit(20000);

  if (error) throw new Error(`Lettura bolle fallita: ${error.message}`);
  return (data ?? []) as unknown as BollaGestionale[];
}

/** Periodo coperto dalle righe della fattura. */
function periodo(righe: RigaFattura[]): { da: string; a: string } | null {
  const date = righe.map((r) => r.data).filter((d): d is string => Boolean(d)).sort();
  return date.length ? { da: date[0], a: date[date.length - 1] } : null;
}

/**
 * Le anomalie che nascono da un controllo.
 *
 * Sono separate dal controllo di proposito: un controllo è un calcolo e si può
 * rifare, un'anomalia è una segnalazione che una persona deciderà. Le regole qui
 * sotto sono quelle che i dati giustificano, non tutte quelle immaginabili.
 */
export function anomalieDi(
  riga: RigaFattura,
  esito: Pick<EsitoAbbinamento, "qualita" | "spedizione">,
  controllo: ControlloAcquisito | null
): AnomaliaAcquisita[] {
  const out: AnomaliaAcquisita[] = [];

  if (esito.qualita === "nessuno") {
    out.push({
      tipo: "fattura_senza_bolla",
      gravita: "anomalia",
      descrizione:
        "Spedizione in fattura senza un documento di trasporto corrispondente.",
      importo: riga.totale,
    });
  }

  if (controllo && controllo.esito === "anomalia") {
    const scarto = controllo.scostamento;
    out.push({
      tipo: "importo_oltre_soglia",
      gravita: "anomalia",
      descrizione:
        scarto == null
          ? "Importo non confrontabile con il costo atteso."
          : `Fatturato ${(scarto * 100).toFixed(1)}% ${scarto > 0 ? "sopra" : "sotto"} il costo atteso di ${controllo.atteso_totale.toFixed(2)} €.`,
      importo:
        riga.totale != null ? Math.round((riga.totale - controllo.atteso_totale) * 100) / 100 : null,
    });
  }

  // Il peso è la voce su cui si discute di più con i vettori, ed è verificabile
  // solo quando la bolla porta un peso: sugli arrivi quasi mai.
  const pesoBolla = esito.spedizione?.peso ?? null;
  if (
    pesoBolla != null &&
    pesoBolla > 0 &&
    riga.peso != null &&
    riga.peso > 0 &&
    Math.abs(riga.peso - pesoBolla) / pesoBolla > 0.05
  ) {
    out.push({
      tipo: "peso_diverso_da_bolla",
      gravita: "da_verificare",
      descrizione: `Peso in fattura ${riga.peso} kg contro ${pesoBolla} kg sulla bolla.`,
      importo: null,
    });
  }

  return out;
}

/**
 * Quello che serve per calcolare il controllo di una riga e che vale per tutta
 * la fattura. Le cache includono il giorno: una nuova tariffa può decorrere a
 * metà mese.
 */
export interface ContestoControllo {
  vettoreId: string;
  vettoreCodice: string;
  rilevazioni: Rilevazione[];
  cacheListino: Map<string, Awaited<ReturnType<typeof risolviListino>>>;
  cacheDescrizione: Map<string, Awaited<ReturnType<typeof descriviListino>>>;
}

export function nuovoContestoControllo(
  vettoreId: string,
  vettoreCodice: string,
  rilevazioni: Rilevazione[]
): ContestoControllo {
  return { vettoreId, vettoreCodice, rilevazioni, cacheListino: new Map(), cacheDescrizione: new Map() };
}

/**
 * `.in()` finisce nella query string: oltre qualche centinaio di identificativi
 * nginx risponde 414. Si interroga a pezzi.
 */
async function aPezzi<T>(valori: T[], leggi: (pezzo: T[]) => Promise<void>, dimensione = 100): Promise<void> {
  for (let i = 0; i < valori.length; i += dimensione) await leggi(valori.slice(i, i + dimensione));
}

/** Le misure del magazzino (pagina Bolle), per spedizione. */
export async function misureBollaPerSpedizione(spedizioniId: string[]): Promise<Map<string, MisuraBolla[]>> {
  const out = new Map<string, MisuraBolla[]>();
  const admin = createAdminClient();
  await aPezzi([...new Set(spedizioniId)], async (pezzo) => {
    const { data, error } = await admin
      .schema("vettori")
      .from("bolla_misure")
      .select("spedizione_id, quantita, lunghezza_cm, larghezza_cm, altezza_cm, peso_reale_kg")
      .in("spedizione_id", pezzo);
    if (error) throw new Error(`Lettura misure delle bolle fallita: ${error.message}`);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(r.spedizione_id);
      const elenco = out.get(id) ?? [];
      elenco.push({
        quantita: Number(r.quantita),
        lunghezzaCm: Number(r.lunghezza_cm),
        larghezzaCm: Number(r.larghezza_cm),
        altezzaCm: Number(r.altezza_cm),
        pesoRealeKg: r.peso_reale_kg == null ? null : Number(r.peso_reale_kg),
      });
      out.set(id, elenco);
    }
  });
  return out;
}

/**
 * Le misure del magazzino per documento gestionale.
 *
 * In acquisizione le spedizioni arrivano dal gestionale e si riconoscono per
 * documento: la spedizione del portale, a cui il magazzino ha attaccato le
 * misure, si ritrova passando da `spedizioni_documenti`. Senza questo passaggio
 * le misure inserite nella pagina Bolle non entravano mai nel controllo.
 */
export async function misureBollaPerDocumento(idDocumenti: number[]): Promise<Map<number, MisuraBolla[]>> {
  const admin = createAdminClient();
  const spedizionePerDocumento = new Map<number, string>();
  await aPezzi([...new Set(idDocumenti)], async (pezzo) => {
    const { data, error } = await admin
      .schema("vettori")
      .from("spedizioni_documenti")
      .select("id_documento, spedizione_id")
      .in("id_documento", pezzo);
    if (error) throw new Error(`Lettura legami bolla-documento fallita: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id_documento: number; spedizione_id: string }>) {
      spedizionePerDocumento.set(Number(r.id_documento), r.spedizione_id);
    }
  });
  const perSpedizione = await misureBollaPerSpedizione([...spedizionePerDocumento.values()]);
  const out = new Map<number, MisuraBolla[]>();
  for (const [documento, spedizione] of spedizionePerDocumento) {
    const misure = perSpedizione.get(spedizione);
    if (misure?.length) out.set(documento, misure);
  }
  return out;
}

/**
 * Il controllo di una riga: listino alla data, dati fisici, costo atteso,
 * classificazione. È la stessa funzione per la fattura appena letta e per il
 * ricalcolo di una già in archivio, così i due non possono divergere.
 *
 * Restituisce anche le anomalie che nascono dal calcolo stesso (oggi: il fuori
 * misura GLS addebitato senza che i nostri dati lo confermino); quelle che
 * dipendono dall'aggancio restano in `anomalieDi`.
 */
export async function calcolaControlloRiga(
  riga: RigaFattura,
  sped: SpedizioneLogica | null | undefined,
  misura: MisuraRiga | undefined,
  misureBolla: MisuraBolla[],
  ctx: ContestoControllo
): Promise<{ controllo: ControlloAcquisito | null; anomalie: AnomaliaAcquisita[] }> {
  if (!riga.data) return { controllo: null, anomalie: [] };
  const provincia = sped?.zonaProvincia || String(riga.dettaglio.provincia ?? "") || null;
  const chiaveCache = `${provincia ?? "-"}|${riga.data}`;
  let risolto = ctx.cacheListino.get(chiaveCache);
  if (!risolto) {
    risolto = await risolviListino({
      vettoreId: ctx.vettoreId,
      data: new Date(`${riga.data}T12:00:00Z`),
      provincia,
    });
    ctx.cacheListino.set(chiaveCache, risolto);
  }
  let descr = ctx.cacheDescrizione.get(chiaveCache);
  if (descr === undefined) {
    descr = await descriviListino(ctx.vettoreId, new Date(`${riga.data}T12:00:00Z`));
    ctx.cacheDescrizione.set(chiaveCache, descr);
  }

  if (!risolto.listino) {
    return {
      anomalie: [],
      controllo: {
        listino_id: null,
        listino_etichetta: null,
        zona_codice: null,
        perc_adeguamento: null,
        perc_carburante: null,
        peso_reale: riga.peso,
        peso_volumetrico: riga.pesoVolumetrico,
        peso_tassabile: riga.pesoTassato,
        peso_applicato: null,
        atteso_nolo: 0,
        atteso_imponibile: 0,
        atteso_adeguamento: 0,
        atteso_carburante: 0,
        atteso_fuori_base: 0,
        atteso_totale: 0,
        atteso_dettaglio: [],
        scostamento: null,
        esito: "non_valutabile",
        avvertenze: [risolto.motivo ?? "Listino non risolvibile per questa riga."],
      },
    };
  }

  const listino = risolto.listino;
  const fisici = datiFisici(riga, sped, misura, ctx.rilevazioni, listino.vettore.divisoreVolumetrico, misureBolla);
  const anomalie: AnomaliaAcquisita[] = [];
  const noteOversized: string[] = [];
  if (ctx.vettoreCodice === "gls") {
    const ov = valutaOversizedGls(fisici.dati, String(riga.dettaglio.codiciSupplemento ?? ""));
    if (ov) {
      noteOversized.push(ov.motivo);
      if (ov.applica) {
        fisici.dati.condizioni = [...new Set([...(fisici.dati.condizioni ?? []), "oversized" as const])];
        fisici.dati.colliOversized = ov.colli;
      }
      if (ov.dichiarato && ov.confermato !== true) {
        const tariffa = listino.supplementi.find((s) => s.condizione === "oversized")?.valore ?? null;
        anomalie.push({
          tipo: "supplemento_non_previsto",
          gravita: ov.confermato === false ? "anomalia" : "da_verificare",
          descrizione: ov.motivo,
          importo: ov.confermato === false ? tariffa : null,
        });
      }
    }
  }
  riga.dettaglio.fonteMisure = fisici.fonte;
  riga.dettaglio.condizioniApplicate = JSON.stringify(fisici.dati.condizioni ?? []);
  riga.dettaglio.formulaVolumetrico = `Volume totale dei colli (m³) × ${listino.vettore.divisoreVolumetrico} kg/m³; per ogni collo: L × P × H in cm ÷ 1.000.000.`;
  const calcolo = calcolaCostoAtteso(fisici.dati, listino);
  const valutabile = riga.totale != null && listino.carburante != null &&
    calcolo.pesoTassabile > 0 && calcolo.fasciaDescrizione !== "nessuna fascia";
  const clsCalcolata = valutabile ? classifica(riga.totale!, calcolo.totale, SOGLIE_DEFAULT)
    : { esito: "non_valutabile", scostamento: null };
  // Senza bolla il peso viene dalla sola fattura: un importo che coincide non
  // dimostra niente, quindi "in linea" non si dichiara. Una deviazione invece
  // resta visibile (da verificare / anomalia): il segnale vale comunque.
  const cls = !sped && clsCalcolata.esito === "in_linea"
    ? { esito: "non_valutabile", scostamento: clsCalcolata.scostamento }
    : clsCalcolata;
  return {
    anomalie,
    controllo: {
      listino_id: descr?.id ?? null,
      listino_etichetta: descr?.etichetta ?? null,
      zona_codice: listino.zonaCodice,
      perc_adeguamento: listino.adeguamento,
      perc_carburante: listino.carburante,
      peso_reale: calcolo.pesoReale,
      peso_volumetrico: calcolo.pesoVolumetrico,
      peso_tassabile: calcolo.pesoTassabile,
      peso_applicato: calcolo.pesoApplicato,
      atteso_nolo: calcolo.nolo,
      atteso_imponibile: calcolo.imponibileNolo,
      atteso_adeguamento: calcolo.adeguamento,
      atteso_carburante: calcolo.carburante,
      atteso_fuori_base: calcolo.fuoriBase,
      atteso_totale: calcolo.totale,
      atteso_dettaglio: calcolo.supplementi,
      scostamento: cls.scostamento,
      esito: cls.esito,
      avvertenze: [...calcolo.avvertenze, ...fisici.note, ...noteOversized, `Fonte peso volumetrico: ${fisici.fonte}.`,
        ...(!provincia ? ["Provincia assente: applicata la zona predefinita del vettore, da verificare."] : []),
        ...(calcolo.pesoTassabile <= 0 ? ["Peso assente: inserire il peso della spedizione."] : []),
        ...(riga.totale == null ? ["Importo fatturato assente."] : []),
        ...(!sped ? ["Bolla non agganciata: il costo calcolato e' solo una simulazione sui dati del vettore, non un controllo."] : []),
        ...(ctx.vettoreCodice === "gls" ? ["ISTAT e carburante di fattura ripartiti sul nolo per confrontare importi completi."] : []),
      ],
    },
  };
}

/**
 * Costruisce il payload completo: aggancia, calcola, classifica.
 */
export async function preparaAcquisizione(params: {
  fattura: FatturaLetta;
  quadraturaOk: boolean;
  quadraturaNote: string | null;
  nomeFile: string | null;
  hashFile: string | null;
  utenteId: string | null;
  metodoLettura?: "testo" | "ocr" | "modello" | "manuale";
  misure?: MisuraRiga[];
  numeroFattura?: string;
  dataFattura?: string;
}): Promise<{ payload: PayloadAcquisizione; riepilogo: RiepilogoAcquisizione }> {
  const fattura = { ...params.fattura, righe: params.fattura.righe.map((r) => {
    const m = params.misure?.find((x) => x.riga === r.numero);
    return m?.direzione ? { ...r, direzione: m.direzione } : r;
  }) };

  const estremi = risolviEstremiFattura(fattura, {
    numero: params.numeroFattura,
    data: params.dataFattura,
  });
  const p = periodo(fattura.righe);
  const bolle = p ? await caricaBolle(p.da, p.a) : [];
  const spedizioni = raggruppaInSpedizioni(bolle);
  const esiti = abbina(fattura.righe, spedizioni);

  const admin = createAdminClient();
  const { data: misureRows, error: misureError } = p ? await admin.schema("vettori").from("rilevazioni")
    .select("*").gte("data_arrivo", giorni(p.da, -7)).lte("data_arrivo", giorni(p.a, 7)).limit(5000)
    : { data: [], error: null };
  if (misureError) throw new Error(`Lettura misure fallita: ${misureError.message}`);
  const rilevazioni = (misureRows ?? []) as Rilevazione[];
  const { data: vRows, error: vError } = await admin
    .schema("vettori")
    .from("vettori")
    .select("id")
    .eq("codice", fattura.vettore)
    .limit(1);
  const vettoreId = (vRows ?? [])[0]?.id as string | undefined;
  if (vError) throw new Error(`Lettura vettore fallita: ${vError.message}`);
  if (!vettoreId) throw new Error(`Vettore ${fattura.vettore} non configurato.`);
  const contesto = nuovoContestoControllo(vettoreId, fattura.vettore, rilevazioni);
  const misureBolla = await misureBollaPerDocumento(esiti.flatMap((e) => e.spedizione?.idDocumenti ?? []));
  const misureBollaDi = (sped: SpedizioneLogica | null | undefined): MisuraBolla[] =>
    (sped?.idDocumenti ?? []).map((id) => misureBolla.get(id)).find((m) => m?.length) ?? [];

  const righe: RigaAcquisita[] = [];
  const spedizioniUsate = new Map<string, SpedizioneLogica>();

  for (const riga of righeConOneri(fattura)) {
    const esito = esiti.find((e) => e.rigaFattura === riga.numero)!;
    const sped = esito.spedizione;
    if (sped) spedizioniUsate.set(sped.chiave, sped);

    const misura = params.misure?.find((m) => m.riga === riga.numero);
    if (misura) riga.dettaglio.misureControllo = JSON.stringify(misura);
    let controllo: ControlloAcquisito | null = null;

    let anomalieCalcolo: AnomaliaAcquisita[] = [];
    if (vettoreId && riga.data) {
      const calcolato = await calcolaControlloRiga(riga, sped, misura, misureBollaDi(sped), contesto);
      controllo = calcolato.controllo;
      anomalieCalcolo = calcolato.anomalie;
    }

    righe.push({
      riga_numero: riga.numero,
      data: riga.data,
      numero_spedizione: riga.numeroSpedizione,
      riferimento: riga.riferimento,
      riferimento_norm: riga.riferimento,
      controparte: riga.controparte,
      direzione: riga.direzione,
      colli: riga.colli,
      peso: riga.peso,
      peso_volumetrico: riga.pesoVolumetrico,
      peso_tassato: riga.pesoTassato,
      nolo: riga.nolo,
      supplementi: riga.supplementi,
      adeguamento: Number(riga.dettaglio.adeguamentoRipartito ?? 0),
      carburante: riga.carburante,
      totale: riga.totale,
      dettaglio: riga.dettaglio,
      confermata: true,
      spedizione_chiave: sped?.chiave ?? null,
      abbinamento: esito.qualita,
      motivo_abbinamento: esito.motivo,
      candidati: esito.candidati,
      controllo,
      anomalie: [...anomalieDi(riga, esito, controllo), ...anomalieCalcolo],
    });
  }

  const somma = (f: (r: RigaAcquisita) => number | null | undefined) =>
    Math.round(righe.reduce((a, r) => a + (f(r) ?? 0), 0) * 100) / 100;

  const conta = (e: string) => righe.filter((r) => r.controllo?.esito === e).length;

  const totaleFatturato = somma((r) => r.totale);
  const totaleAtteso = somma((r) => r.controllo?.atteso_totale);

  return {
    payload: {
      vettore_codice: fattura.vettore,
      numero: estremi.numero,
      data_fattura: estremi.data,
      anno: estremi.data ? Number(estremi.data.slice(0, 4)) : fattura.anno,
      mese: estremi.data ? Number(estremi.data.slice(5, 7)) : fattura.mese,
      nome_file: params.nomeFile,
      hash_file: params.hashFile,
      metodo_lettura: params.metodoLettura ?? "testo",
      quadratura_ok: params.quadraturaOk,
      quadratura_note: params.quadraturaNote,
      utente_id: params.utenteId,
      totali: fattura.totali,
      spedizioni: [...spedizioniUsate.values()],
      righe,
    },
    riepilogo: {
      righe: righe.length,
      agganciate: righe.filter((r) => r.abbinamento === "numero").length,
      daConfermare: righe.filter((r) => r.abbinamento === "assistito").length,
      senzaCandidati: righe.filter((r) => r.abbinamento === "nessuno").length,
      inLinea: conta("in_linea"),
      daVerificare: conta("da_verificare"),
      anomalie: conta("anomalia"),
      nonValutabili: conta("non_valutabile") + righe.filter((r) => !r.controllo).length,
      totaleFatturato,
      totaleAtteso,
      differenza: Math.round((totaleFatturato - totaleAtteso) * 100) / 100,
    },
  };
}

/** Scrive il payload chiamando la RPC transazionale. */
export async function salvaAcquisizione(payload: PayloadAcquisizione) {
  const erroreEstremi = erroreEstremiMancanti(payload.vettore_codice, {
    numero: payload.numero,
    data: payload.data_fattura,
  });
  if (erroreEstremi) throw new Error(erroreEstremi);

  // La stessa fusione usata dalla pagina Bolle precede l'RPC transazionale.
  // In questo modo una bolla manuale viene collegata ai documenti prima che il
  // controllo nasca e la congeli; la normalizzazione resta quella condivisa in
  // `fatture/testo.ts`, gia applicata da `raggruppaInSpedizioni`.
  await sincronizzaSpedizioniGestionali(payload.spedizioni);
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vettori")
    .rpc("acquisisci_fattura", { p_payload: payload });
  if (error) throw new Error(error.message);
  return data as {
    fattura_id: string;
    righe: number;
    spedizioni_nuove: number;
    controlli: number;
    anomalie: number;
  };
}
