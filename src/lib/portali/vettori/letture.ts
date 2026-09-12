import { createAdminClient } from "@/lib/supabase/admin";
import type { FasciaModificabile } from "./listini-config";

/**
 * Letture del portale per le pagine Anomalie, Analisi e Listini.
 *
 * Sta separata da `listino-service.ts` perché risponde a domande diverse:
 * lì si risolve *un* listino a una data per calcolare un prezzo, qui si
 * mostra all'operatore quello che c'è. Mescolarle significherebbe caricare
 * fasce e supplementi ogni volta che serve solo un elenco.
 */

const SCHEMA = "vettori";

/* ------------------------------------------------------------------ */
/*  Anomalie                                                           */
/* ------------------------------------------------------------------ */

export interface AnomaliaElenco {
  id: string;
  tipo: string;
  gravita: "da_verificare" | "anomalia" | "informativa";
  stato: "aperta" | "contestata" | "accettata" | "corretta";
  descrizione: string;
  importo_contestato: number | null;
  motivazione: string | null;
  creata_il: string;
  decisa_il: string | null;
  vettore_codice: string | null;
  vettore_nome: string | null;
  fattura_numero: string | null;
  fattura_data: string | null;
  anno: number | null;
  mese: number | null;
  riga_numero: number | null;
  riferimento: string | null;
  controparte: string | null;
  direzione: string | null;
  data_spedizione: string | null;
  colli: number | null;
  peso: number | null;
  peso_tassato: number | null;
  fatturato: number | null;
  atteso: number | null;
  scostamento: number | null;
  listino: string | null;
  zona: string | null;
  abbinamento: string | null;
}

export interface FiltroAnomalie {
  stati?: string[] | null;
  vettore?: string | null;
  da?: string | null;
  a?: string | null;
  limite?: number;
}

export async function elencoAnomalie(f: FiltroAnomalie = {}): Promise<AnomaliaElenco[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.schema(SCHEMA).rpc("elenco_anomalie", {
    p_stati: f.stati ?? null,
    p_vettore: f.vettore ?? null,
    p_da: f.da ?? null,
    p_a: f.a ?? null,
    p_limite: f.limite ?? 400,
  });
  if (error) throw new Error(`Lettura anomalie fallita: ${error.message}`);
  return (data ?? []) as AnomaliaElenco[];
}

/* ------------------------------------------------------------------ */
/*  Analisi                                                            */
/* ------------------------------------------------------------------ */

export interface AnalisiVettore {
  codice: string;
  nome: string;
  righe: number;
  colli: number;
  kg: number;
  fatturato: number;
  atteso: number;
  in_linea: number;
  da_verificare: number;
  anomalie: number;
  non_valutabili: number;
  senza_bolla: number;
  contestato: number;
}

export interface AnalisiMese {
  anno: number;
  mese: number;
  righe: number;
  colli: number;
  kg: number;
  fatturato: number;
  atteso: number;
  anomalie: number;
}

export interface Analisi {
  da: string;
  a: string;
  totali: {
    righe: number;
    colli: number;
    kg: number;
    fatturato: number;
    atteso: number;
    anomalie: number;
  };
  vettori: AnalisiVettore[];
  mesi: AnalisiMese[];
  tipi_anomalia: Array<{
    tipo: string;
    quante: number;
    aperte: number;
    contestato: number;
  }>;
}

export async function analisi(da: string, a: string): Promise<Analisi> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema(SCHEMA)
    .rpc("analisi", { p_da: da, p_a: a });
  if (error) throw new Error(`Analisi fallita: ${error.message}`);
  return data as Analisi;
}

/* ------------------------------------------------------------------ */
/*  Arrivi — rilevazioni di magazzino                                  */
/* ------------------------------------------------------------------ */

export interface Rilevazione {
  id: string;
  spedizione_id: string | null;
  fornitore_testo: string | null;
  numero_bolla: string | null;
  data_arrivo: string;
  colli: number;
  peso_kg: number | null;
  lunghezza_cm: number | null;
  larghezza_cm: number | null;
  altezza_cm: number | null;
  condizioni: string[];
  note: string | null;
  rilevata_il: string;
  rilevata_da: string | null;
}

/** Le rilevazioni recenti, per rivedere e correggere quello appena inserito. */
export async function rilevazioniRecenti(giorni = 30, limite = 100): Promise<Rilevazione[]> {
  const admin = createAdminClient();
  const dal = new Date();
  dal.setUTCDate(dal.getUTCDate() - giorni);
  const { data, error } = await admin
    .schema(SCHEMA)
    .from("rilevazioni")
    .select(
      "id, spedizione_id, fornitore_testo, numero_bolla, data_arrivo, colli, peso_kg, " +
        "lunghezza_cm, larghezza_cm, altezza_cm, condizioni, note, rilevata_il, rilevata_da"
    )
    .gte("data_arrivo", dal.toISOString().slice(0, 10))
    .order("rilevata_il", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`Lettura rilevazioni fallita: ${error.message}`);
  return (data ?? []) as unknown as Rilevazione[];
}

/* ------------------------------------------------------------------ */
/*  Listini                                                            */
/* ------------------------------------------------------------------ */

export interface VettoreConfig {
  id: string;
  codice: string;
  nome: string;
  modello_tariffa: string;
  divisore_volumetrico: number;
  peso_minimo_tassabile: number;
  arrotondamento_kg: number;
  arrotondamento_da_kg: number;
  attivo: boolean;
  a_nostro_carico: boolean;
}

export interface ListinoRiepilogo {
  vettore: VettoreConfig;
  listino: {
    id: string;
    etichetta: string;
    valido_dal: string;
    valido_al: string | null;
  } | null;
  zone: Array<{ id: string; codice: string; nome: string; is_default: boolean; province: string[] }>;
  dettaglioFasce: FasciaModificabile[];
  fasce: number;
  /** Quante fasce si tariffano a quintale invece che a importo fisso. */
  fasceQuintale: number;
  supplementi: Array<{
    codice: string;
    nome: string;
    tipo_calcolo: string;
    valore: number;
    base_nolo: boolean;
    condizione: string | null;
  }>;
  adeguamento: number | null;
  carburante: Array<{ anno: number; mese: number; percentuale: number; fonte: string }>;
}

/**
 * Tutto quello che serve alla pagina Listini, in un colpo solo.
 *
 * Si carica lo storico carburante per risolvere anche comunicazioni vecchie
 * ancora valide: il limite visivo degli otto mesi non limita il calcolo.
 */
export async function riepilogoListini(oggiISO: string): Promise<ListinoRiepilogo[]> {
  const admin = createAdminClient();

  const { data: vettoriRows, error: eV } = await admin
    .schema(SCHEMA)
    .from("vettori")
    .select(
      "id, codice, nome, modello_tariffa, divisore_volumetrico, peso_minimo_tassabile, " +
        "arrotondamento_kg, arrotondamento_da_kg, attivo, a_nostro_carico"
    )
    .order("nome");
  if (eV) throw new Error(`Lettura vettori fallita: ${eV.message}`);
  const vettori = (vettoriRows ?? []) as unknown as VettoreConfig[];

  const [listini, zone, fasce, supplementi, adeguamenti, carburante] = await Promise.all([
    admin
      .schema(SCHEMA)
      .from("listini")
      .select("id, vettore_id, etichetta, valido_dal, valido_al")
      .lte("valido_dal", oggiISO)
      .or(`valido_al.is.null,valido_al.gte.${oggiISO}`)
      .order("valido_dal", { ascending: false }),
    admin
      .schema(SCHEMA)
      .from("zone")
      .select("id, vettore_id, codice, nome, is_default, ordine, zone_province(provincia)")
      .order("ordine"),
    admin.schema(SCHEMA).from("listini_fasce").select("listino_id, zona_id, peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo").order("peso_da"),
    admin
      .schema(SCHEMA)
      .from("listini_supplementi")
      .select("listino_id, codice, nome, tipo_calcolo, valore, base_nolo, condizione, ordine")
      .order("ordine"),
    admin
      .schema(SCHEMA)
      .from("adeguamenti")
      .select("vettore_id, percentuale, valido_dal, valido_al")
      .lte("valido_dal", oggiISO)
      .or(`valido_al.is.null,valido_al.gte.${oggiISO}`)
      .order("valido_dal", { ascending: false }),
    admin
      .schema(SCHEMA)
      .from("carburante")
      .select("vettore_id, anno, mese, percentuale, fonte")
      .order("anno", { ascending: false })
      .order("mese", { ascending: false }),
  ]);
  for (const risultato of [listini, zone, fasce, supplementi, adeguamenti, carburante]) {
    if (risultato.error) throw new Error(`Lettura listini fallita: ${risultato.error.message}`);
  }

  type Riga = Record<string, unknown>;
  const primoPer = <T extends Riga>(righe: T[] | null, vettoreId: string) =>
    (righe ?? []).find((r) => r.vettore_id === vettoreId);

  return vettori.map((v) => {
    const listino = primoPer(listini.data as Riga[] | null, v.id) as
      | { id: string; etichetta: string; valido_dal: string; valido_al: string | null }
      | undefined;
    const adeg = primoPer(adeguamenti.data as Riga[] | null, v.id) as
      | { percentuale: number }
      | undefined;

    return {
      vettore: v,
      listino: listino
        ? {
            id: listino.id,
            etichetta: listino.etichetta,
            valido_dal: listino.valido_dal,
            valido_al: listino.valido_al,
          }
        : null,
      zone: ((zone.data ?? []) as unknown as Array<{
        id: string;
        vettore_id: string;
        codice: string;
        nome: string;
        is_default: boolean;
        zone_province: Array<{ provincia: string }> | null;
      }>)
        .filter((z) => z.vettore_id === v.id)
        .map((z) => ({
          id: z.id,
          codice: z.codice,
          nome: z.nome,
          is_default: z.is_default,
          province: (z.zone_province ?? []).map((p) => p.provincia.toUpperCase()),
        })),
      dettaglioFasce: listino ? ((fasce.data ?? []) as Array<FasciaModificabile & { listino_id: string }>)
        .filter((f) => f.listino_id === listino.id).map(({ listino_id: _id, ...f }) => f) : [],
      fasce: listino
        ? ((fasce.data ?? []) as Array<{ listino_id: string }>).filter(
            (f) => f.listino_id === listino.id
          ).length
        : 0,
      // Il modello tariffario vero sta nelle fasce, non nella colonna
      // `modello_tariffa` del vettore: Trading Post ha otto fasce a importo
      // fisso e la nona, quella aperta, a quintale. Descriverlo con la sola
      // colonna del vettore direbbe «a scaglioni» e nasconderebbe il pezzo
      // che conta sulle spedizioni pesanti.
      fasceQuintale: listino
        ? ((fasce.data ?? []) as Array<{ listino_id: string; tipo: string }>).filter(
            (f) => f.listino_id === listino.id && f.tipo === "quintale"
          ).length
        : 0,
      supplementi: listino
        ? ((supplementi.data ?? []) as unknown as Array<{
            listino_id: string;
            codice: string;
            nome: string;
            tipo_calcolo: string;
            valore: number;
            base_nolo: boolean;
            condizione: string | null;
          }>)
            .filter((s) => s.listino_id === listino.id)
            .map(({ listino_id: _ignora, ...resto }) => resto)
        : [],
      adeguamento: adeg ? Number(adeg.percentuale) : null,
      carburante: ((carburante.data ?? []) as unknown as Array<{
        vettore_id: string;
        anno: number;
        mese: number;
        percentuale: number;
        fonte: string;
      }>)
        .filter((c) => c.vettore_id === v.id)
        .map((c) => ({
          anno: c.anno,
          mese: c.mese,
          percentuale: Number(c.percentuale),
          fonte: c.fonte,
        })),
    };
  });
}
