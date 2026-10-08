import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BollaGestionale, SpedizioneLogica } from "./abbinamento";
import { raggruppaInSpedizioni } from "./abbinamento";
import { normalizzaRiferimento } from "./fatture/testo";
import { volumeGruppoM3 } from "./misure";
import type {
  CampiBollaForzati,
  CampoBollaForzabile,
  VettoreEsito,
} from "./tipi";

export const CAMPI_BOLLA_FORZABILI = [
  "direzione",
  "numero_riferimento",
  "data_documento",
  "controparte_nome",
  "vettore_id",
  "colli_bolla",
  "peso_bolla",
] as const satisfies readonly CampoBollaForzabile[];

const CampoBollaForzabileSchema = z.enum(CAMPI_BOLLA_FORZABILI);
const DataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida");

export const GruppoMisuraBollaInput = z.object({
  quantita: z.number().int().positive().max(999),
  lunghezzaCm: z.number().finite().min(1).max(2000),
  larghezzaCm: z.number().finite().min(1).max(2000),
  altezzaCm: z.number().finite().min(1).max(2000),
  pesoRealeKg: z.number().finite().positive().max(100_000).nullable().optional(),
});

const ValoriTestataBolla = z.object({
  direzione: z.enum(["entrata", "uscita"]),
  numeroRiferimento: z.string().trim().min(1).max(100),
  /** Sugli arrivi: il nostro protocollo BF, diverso dal DDT del fornitore. */
  numeroProtocollo: z.string().trim().max(100).nullable().optional(),
  dataDocumento: DataISO,
  controparteNome: z.string().trim().min(1).max(240),
  vettoreId: z.string().uuid(),
  colli: z.number().int().positive().max(999_999),
  pesoKg: z.number().finite().positive().max(100_000_000),
});

export const MutazioneTestataBolla = z.discriminatedUnion("operazione", [
  ValoriTestataBolla.extend({
    operazione: z.literal("crea_bolla"),
    misure: z.array(GruppoMisuraBollaInput).min(1).max(100),
  }),
  ValoriTestataBolla.extend({
    operazione: z.literal("aggiorna_bolla"),
    spedizioneId: z.string().uuid(),
  }),
  z.object({
    operazione: z.literal("ripristina_campo"),
    spedizioneId: z.string().uuid(),
    campo: CampoBollaForzabileSchema,
  }),
  z.object({
    operazione: z.literal("scongela"),
    spedizioneId: z.string().uuid(),
    motivo: z.string().trim().min(3).max(500),
  }),
]);

export type ValoriTestataBollaInput = z.infer<typeof ValoriTestataBolla>;

interface SpedizioneRow {
  id: string;
  direzione: "entrata" | "uscita";
  vettore_id: string | null;
  numero_riferimento: string | null;
  numero_riferimento_norm: string | null;
  data_documento: string;
  controparte_codice: string | null;
  controparte_nome: string | null;
  zona_cap: string | null;
  zona_provincia: string | null;
  fonte_zona: string | null;
  porto_codice: string | null;
  porto_descrizione: string | null;
  a_nostro_carico: boolean | null;
  colli_bolla: number | null;
  peso_bolla: number | null;
  origine: "gestionale" | "manuale" | "excel_storico";
  numero_protocollo: string | null;
  campi_forzati: unknown;
  congelata: boolean;
}

interface DettaglioDocumento {
  codiceProfilo: string | null;
  tipoRegistro: string | null;
  numeroProgressivo: string | null;
  numeroDocumento: string | null;
}

export interface CodiceGestionaleVettore {
  codiceGestionale: string;
  ragioneSociale: string;
  vettoreId: string | null;
  tipo: "vettore" | "regola" | "non_nostro" | "da_mappare";
  regolaTesto: string | null;
  /**
   * Le bolle con questo vettore non arrivano al banco: nascono gia'
   * `ignorata`. L'amministrazione non ne controlla le fatture (Trascoop,
   * 30/09/2026). Facoltativo: chi non lo legge si comporta come prima.
   */
  nascondiBolle?: boolean;
}

export interface RisoluzioneVettoreGestionale {
  codiceGestionale: string | null;
  vettoreId: string | null;
  esito: VettoreEsito;
  regola: string | null;
  ragioneSociale: string | null;
}

/**
 * Traduce il codice del gestionale senza indovinare il vettore.
 *
 * Il confronto diretto con gli slug lasciava 734 spedizioni su 1.210 senza
 * vettore. I 17 codici reali hanno invece significati diversi: 478 documenti
 * assegnano un vettore, 120 esprimono una regola e 166 richiedono una
 * classificazione umana. Tenere distinti gli esiti evita di presentare tutti
 * questi casi come un generico dato mancante.
 */
export function risolviVettoreGestionale(
  codice: string | null,
  codici: ReadonlyMap<string, CodiceGestionaleVettore>
): RisoluzioneVettoreGestionale {
  const codiceGestionale = codice?.trim().toUpperCase() || null;
  if (!codiceGestionale) {
    return {
      codiceGestionale: null,
      vettoreId: null,
      esito: "assente",
      regola: null,
      ragioneSociale: null,
    };
  }

  const configurazione = codici.get(codiceGestionale);
  if (!configurazione) {
    return {
      codiceGestionale,
      vettoreId: null,
      esito: "da_classificare",
      regola: null,
      ragioneSociale: null,
    };
  }

  if (configurazione.tipo === "vettore" && configurazione.vettoreId) {
    return {
      codiceGestionale,
      vettoreId: configurazione.vettoreId,
      esito: "assegnato",
      regola: null,
      ragioneSociale: configurazione.ragioneSociale,
    };
  }
  if (configurazione.tipo === "regola") {
    return {
      codiceGestionale,
      vettoreId: null,
      esito: "regola",
      regola: configurazione.regolaTesto,
      ragioneSociale: configurazione.ragioneSociale,
    };
  }
  if (configurazione.tipo === "non_nostro") {
    return {
      codiceGestionale,
      vettoreId: null,
      esito: "esterno",
      regola: null,
      ragioneSociale: configurazione.ragioneSociale,
    };
  }
  return {
    codiceGestionale,
    vettoreId: null,
    esito: "da_classificare",
    regola: null,
    ragioneSociale: configurazione.ragioneSociale,
  };
}

type ValoreCampo = string | number | boolean | null;
type ValoriForzabili = Record<CampoBollaForzabile, ValoreCampo>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function campiForzatiDaDb(value: unknown): CampiBollaForzati {
  if (!isRecord(value)) return {};
  const risultato: CampiBollaForzati = {};
  for (const campo of CAMPI_BOLLA_FORZABILI) {
    const dettaglio = value[campo];
    if (
      !isRecord(dettaglio) ||
      !("valore_precedente" in dettaglio) ||
      typeof dettaglio.forzato_da !== "string" ||
      typeof dettaglio.forzato_il !== "string"
    ) {
      continue;
    }
    const precedente = dettaglio.valore_precedente;
    if (
      precedente !== null &&
      typeof precedente !== "string" &&
      typeof precedente !== "number" &&
      typeof precedente !== "boolean"
    ) {
      continue;
    }
    risultato[campo] = {
      valorePrecedente: precedente,
      forzatoDa: dettaglio.forzato_da,
      forzatoIl: dettaglio.forzato_il,
    };
  }
  return risultato;
}

function campiForzatiPerDb(value: CampiBollaForzati): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([campo, dettaglio]) => [
      campo,
      {
        valore_precedente: dettaglio?.valorePrecedente ?? null,
        forzato_da: dettaglio?.forzatoDa,
        forzato_il: dettaglio?.forzatoIl,
      },
    ])
  );
}

function valoreRiga(riga: SpedizioneRow, campo: CampoBollaForzabile): ValoreCampo {
  return riga[campo];
}

/** Piano puro della fusione, tenuto separato dall'I/O per rendere testabili le regole. */
export function pianificaFusioneCampi(
  attuali: ValoriForzabili,
  gestionali: ValoriForzabili,
  forzati: CampiBollaForzati,
  congelata: boolean
): {
  aggiornamenti: Partial<ValoriForzabili>;
  differenze: Record<string, { spedizione: ValoreCampo; gestionale: ValoreCampo }>;
} {
  const aggiornamenti: Partial<ValoriForzabili> = {};
  const differenze: Record<string, { spedizione: ValoreCampo; gestionale: ValoreCampo }> = {};
  for (const campo of CAMPI_BOLLA_FORZABILI) {
    if (attuali[campo] !== gestionali[campo]) {
      differenze[campo] = { spedizione: attuali[campo], gestionale: gestionali[campo] };
    }
    if (congelata || forzati[campo]) continue;
    if (gestionaleNonSa(campo, gestionali[campo]) && !gestionaleNonSa(campo, attuali[campo])) continue;
    aggiornamenti[campo] = gestionali[campo];
  }
  return { aggiornamenti, differenze };
}

/**
 * Il gestionale che non sa non cancella chi sa.
 *
 * Sulle partenze il codice vettore manca spesso (386 bolle col mezzo `V` e
 * nessun codice) o e' una regola che non indica un vettore; sugli arrivi
 * colli e peso arrivano a zero. Se nel frattempo il dato l'ha messo qualcuno
 * — il vettore scelto in simulazione, i colli contati al banco — la
 * sincronizzazione notturna lo azzerava, e la bolla perdeva proprio quello
 * che l'operatore aveva inserito per non doverlo ribattere.
 */
const CAMPI_CHE_IL_GESTIONALE_PUO_NON_SAPERE = new Set<CampoBollaForzabile>([
  "vettore_id",
  "colli_bolla",
  "peso_bolla",
]);

function gestionaleNonSa(campo: CampoBollaForzabile, valore: ValoreCampo): boolean {
  return (
    CAMPI_CHE_IL_GESTIONALE_PUO_NON_SAPERE.has(campo) &&
    (valore === null || valore === undefined || valore === 0)
  );
}

function valoriDaInput(input: ValoriTestataBollaInput) {
  return {
    direzione: input.direzione,
    numero_riferimento: input.numeroRiferimento,
    numero_riferimento_norm: normalizzaRiferimento(input.numeroRiferimento),
    data_documento: input.dataDocumento,
    controparte_nome: input.controparteNome,
    vettore_id: input.vettoreId,
    colli_bolla: input.colli,
    peso_bolla: input.pesoKg,
    numero_protocollo: input.numeroProtocollo?.trim() || null,
  };
}

export async function creaBollaManuale(
  input: z.infer<typeof MutazioneTestataBolla> & { operazione: "crea_bolla" },
  utenteId: string
): Promise<string> {
  const riferimentoNorm = normalizzaRiferimento(input.numeroRiferimento);
  if (!riferimentoNorm) {
    throw new Error("Il numero bolla deve contenere almeno una lettera o una cifra significativa.");
  }

  const admin = createAdminClient();
  const { data: esistenti, error: ricercaError } = await admin
    .schema("vettori")
    .from("spedizioni")
    .select("id")
    .eq("direzione", input.direzione)
    .eq("numero_riferimento_norm", riferimentoNorm)
    .eq("data_documento", input.dataDocumento)
    .limit(1);
  if (ricercaError) throw new Error(ricercaError.message);
  if ((esistenti ?? []).length > 0) {
    throw new ErroreBollaDuplicata();
  }

  const payload = {
    direzione: input.direzione,
    vettore_id: input.vettoreId,
    numero_riferimento: input.numeroRiferimento,
    numero_riferimento_norm: riferimentoNorm,
    data_documento: input.dataDocumento,
    controparte_nome: input.controparteNome,
    colli_bolla: input.colli,
    peso_bolla: input.pesoKg,
    utente_id: utenteId,
    misure: input.misure.map((misura) => ({
      quantita: misura.quantita,
      lunghezza_cm: misura.lunghezzaCm,
      larghezza_cm: misura.larghezzaCm,
      altezza_cm: misura.altezzaCm,
      peso_reale_kg: misura.pesoRealeKg ?? null,
      volume_m3: Number(volumeGruppoM3(misura).toFixed(6)),
    })),
  };
  const { data, error } = await admin
    .schema("vettori")
    .rpc("crea_bolla_manuale", { p_payload: payload });
  if (error?.code === "23505") throw new ErroreBollaDuplicata();
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("La bolla e stata creata senza identificativo.");
  // La RPC non conosce il protocollo (e' della 117): lo si aggiunge dopo.
  const protocollo = input.numeroProtocollo?.trim();
  if (protocollo) {
    const { error: protocolloError } = await admin
      .schema("vettori")
      .from("spedizioni")
      .update({ numero_protocollo: protocollo })
      .eq("id", data);
    if (protocolloError) throw new Error(protocolloError.message);
  }
  return data;
}

export class ErroreBollaDuplicata extends Error {
  constructor() {
    super("Esiste gia una bolla con la stessa direzione, numero e data.");
    this.name = "ErroreBollaDuplicata";
  }
}

export class ErroreBollaCongelata extends Error {
  constructor() {
    super("La bolla e congelata perche e gia agganciata a una fattura.");
    this.name = "ErroreBollaCongelata";
  }
}

export async function aggiornaBolla(
  input: z.infer<typeof MutazioneTestataBolla> & { operazione: "aggiorna_bolla" },
  utenteId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vettori")
    .from("spedizioni")
    .select("id,direzione,vettore_id,numero_riferimento,numero_riferimento_norm,data_documento,controparte_codice,controparte_nome,zona_cap,zona_provincia,fonte_zona,porto_codice,porto_descrizione,a_nostro_carico,colli_bolla,peso_bolla,origine,campi_forzati,congelata")
    .eq("id", input.spedizioneId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Bolla non trovata.");
  const riga = data as unknown as SpedizioneRow;
  if (riga.congelata) throw new ErroreBollaCongelata();

  const valori = valoriDaInput(input);
  if (!valori.numero_riferimento_norm) {
    throw new Error("Il numero bolla deve contenere almeno una lettera o una cifra significativa.");
  }

  const { count, error: documentiError } = await admin
    .schema("vettori")
    .from("spedizioni_documenti")
    .select("id_documento", { count: "exact", head: true })
    .eq("spedizione_id", input.spedizioneId);
  if (documentiError) throw new Error(documentiError.message);

  const campiForzati = campiForzatiDaDb(riga.campi_forzati);
  if ((count ?? 0) > 0) {
    const adesso = new Date().toISOString();
    for (const campo of CAMPI_BOLLA_FORZABILI) {
      if (valori[campo] === valoreRiga(riga, campo)) continue;
      campiForzati[campo] ??= {
        valorePrecedente: valoreRiga(riga, campo),
        forzatoDa: utenteId,
        forzatoIl: adesso,
      };
    }
  }

  const { error: updateError } = await admin
    .schema("vettori")
    .from("spedizioni")
    .update({
      ...valori,
      campi_forzati: campiForzatiPerDb(campiForzati),
      aggiornata_il: new Date().toISOString(),
    })
    .eq("id", input.spedizioneId);
  if (updateError?.code === "23505") throw new ErroreBollaDuplicata();
  if (updateError) {
    if (updateError.code === "55000") throw new ErroreBollaCongelata();
    throw new Error(updateError.message);
  }
}

export async function ripristinaCampoBolla(
  spedizioneId: string,
  campo: CampoBollaForzabile
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vettori")
    .from("spedizioni")
    .select("id,direzione,vettore_id,numero_riferimento,numero_riferimento_norm,data_documento,controparte_codice,controparte_nome,zona_cap,zona_provincia,fonte_zona,porto_codice,porto_descrizione,a_nostro_carico,colli_bolla,peso_bolla,origine,campi_forzati,congelata")
    .eq("id", spedizioneId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Bolla non trovata.");
  const riga = data as unknown as SpedizioneRow;
  if (riga.congelata) throw new ErroreBollaCongelata();
  const campi = campiForzatiDaDb(riga.campi_forzati);
  const dettaglio = campi[campo];
  if (!dettaglio) return;

  delete campi[campo];
  const valore = dettaglio.valorePrecedente;
  const aggiornamento: Record<string, unknown> = {
    [campo]: valore,
    campi_forzati: campiForzatiPerDb(campi),
    aggiornata_il: new Date().toISOString(),
  };
  if (campo === "numero_riferimento") {
    aggiornamento.numero_riferimento_norm = normalizzaRiferimento(
      typeof valore === "string" ? valore : null
    );
  }
  const { error: updateError } = await admin
    .schema("vettori")
    .from("spedizioni")
    .update(aggiornamento)
    .eq("id", spedizioneId);
  if (updateError?.code === "55000") throw new ErroreBollaCongelata();
  if (updateError) throw new Error(updateError.message);
}

function dettagliDocumenti(bolle: BollaGestionale[]): Map<number, DettaglioDocumento> {
  return new Map(
    bolle.map((bolla) => [
      bolla.id_documento,
      {
        codiceProfilo: bolla.codice_profilo,
        tipoRegistro: bolla.tipo_registro,
        numeroProgressivo: bolla.numero_progressivo,
        numeroDocumento: bolla.numero_documento,
      },
    ])
  );
}

function differenzeGestionali(
  riga: SpedizioneRow,
  valori: ReturnType<typeof valoriGestionali>
): Record<string, { spedizione: ValoreCampo; gestionale: ValoreCampo }> {
  return pianificaFusioneCampi(
    Object.fromEntries(
      CAMPI_BOLLA_FORZABILI.map((campo) => [campo, valoreRiga(riga, campo)])
    ) as ValoriForzabili,
    Object.fromEntries(
      CAMPI_BOLLA_FORZABILI.map((campo) => [campo, valori[campo]])
    ) as ValoriForzabili,
    campiForzatiDaDb(riga.campi_forzati),
    riga.congelata
  ).differenze;
}

/**
 * Il nostro protocollo sugli arrivi.
 *
 * La bolla fornitore ha due numeri: il DDT del fornitore, che la fattura del
 * vettore cita e che quindi resta la chiave di aggancio (`numero_riferimento`),
 * e il nostro progressivo BF, con cui l'amministrazione la cerca. Sulle
 * partenze coincidono e non serve.
 */
export function protocolloDaDocumenti(
  spedizione: Pick<SpedizioneLogica, "direzione" | "idDocumenti">,
  dettagli: Map<number, Pick<DettaglioDocumento, "numeroProgressivo">>
): string | null {
  if (spedizione.direzione !== "entrata") return null;
  const numeri = [
    ...new Set(
      spedizione.idDocumenti
        .map((id) => dettagli.get(id)?.numeroProgressivo?.trim())
        .filter((numero): numero is string => Boolean(numero))
    ),
  ].sort();
  return numeri.length > 0 ? numeri.join(", ") : null;
}

function valoriGestionali(spedizione: SpedizioneLogica, vettoreId: string | null) {
  return {
    direzione: spedizione.direzione,
    vettore_id: vettoreId,
    numero_riferimento: spedizione.riferimento,
    numero_riferimento_norm: spedizione.riferimentoNorm,
    data_documento: spedizione.dataDocumento,
    controparte_codice: spedizione.codiceControparte,
    controparte_nome: spedizione.controparte,
    zona_cap: spedizione.zonaCap,
    zona_provincia: spedizione.zonaProvincia,
    fonte_zona: null,
    porto_codice: spedizione.portoCodice,
    porto_descrizione: spedizione.porto,
    a_nostro_carico: spedizione.aNostroCarico,
    colli_bolla: spedizione.colli,
    peso_bolla: spedizione.peso,
  };
}

/**
 * Porta le testate gestionali dentro `vettori.spedizioni`. La normalizzazione
 * avviene esclusivamente in `raggruppaInSpedizioni`, che usa
 * `normalizzaRiferimento`: il database riceve la chiave gia normalizzata.
 */
export async function sincronizzaBolleGestionali(bolle: BollaGestionale[]): Promise<void> {
  await sincronizzaSpedizioniGestionali(
    raggruppaInSpedizioni(bolle),
    dettagliDocumenti(bolle)
  );
}

type ClienteAdmin = ReturnType<typeof createAdminClient>;

const COLONNE_SPEDIZIONE =
  "id,direzione,vettore_id,numero_riferimento,numero_riferimento_norm,data_documento,controparte_codice,controparte_nome,zona_cap,zona_provincia,fonte_zona,porto_codice,porto_descrizione,a_nostro_carico,colli_bolla,peso_bolla,numero_protocollo,origine,campi_forzati,congelata";

/** Elementi per richiesta in un filtro `in`: tiene la URL sotto i limiti dei proxy. */
const PER_RICHIESTA = 150;
/** Spedizioni fuse alla volta: la lettura anticipata delle righe non invecchia. */
const PER_BLOCCO = 100;

function aBlocchi<T>(elementi: T[], dimensione: number): T[][] {
  const blocchi: T[][] = [];
  for (let i = 0; i < elementi.length; i += dimensione) {
    blocchi.push(elementi.slice(i, i + dimensione));
  }
  return blocchi;
}

/**
 * Stesso valore, anche se il database dice `0.340` e il codice `0.34`.
 *
 * I numeri si confrontano a meno di mezzo millesimo: i pesi sono numeric(_,3),
 * mentre la somma dei pesi di piu' documenti in JavaScript da' rumore
 * (64.41600000000001 contro 64.416) e la riga sembrerebbe cambiata a ogni
 * fusione.
 */
function uguale(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") {
    return Math.abs(Number(a) - Number(b)) < 0.0005;
  }
  return a === b;
}

interface LegameRow {
  spedizione_id: string;
  id_documento: number;
  codice_profilo: string | null;
  tipo_registro: string | null;
  numero_progressivo: string | null;
  numero_documento: string | null;
}

/**
 * Cosa scrivere sulla spedizione per allinearla al gestionale, o `null` se e'
 * gia' allineata.
 *
 * Le regole sono quelle di sempre (`pianificaFusioneCampi`: i campi forzati e
 * quelli che il gestionale non sa restano); cambia solo che una spedizione
 * invariata non si riscrive. Prima ogni apertura della pagina Bolle scriveva
 * 350 righe su 350 anche quando non era cambiato niente.
 */
export function pianificaAggiornamentoSpedizione(
  riga: SpedizioneRow,
  valori: ReturnType<typeof valoriGestionali>,
  protocollo: string | null
): Record<string, unknown> | null {
  const forzati = campiForzatiDaDb(riga.campi_forzati);
  const piano = pianificaFusioneCampi(
    Object.fromEntries(
      CAMPI_BOLLA_FORZABILI.map((campo) => [campo, valoreRiga(riga, campo)])
    ) as ValoriForzabili,
    Object.fromEntries(
      CAMPI_BOLLA_FORZABILI.map((campo) => [campo, valori[campo]])
    ) as ValoriForzabili,
    forzati,
    false
  );
  const aggiornamento: Record<string, unknown> = { ...valori, origine: riga.origine };
  for (const campo of CAMPI_BOLLA_FORZABILI) {
    aggiornamento[campo] =
      campo in piano.aggiornamenti ? piano.aggiornamenti[campo] : valoreRiga(riga, campo);
  }
  if (!("numero_riferimento" in piano.aggiornamenti)) {
    aggiornamento.numero_riferimento_norm = riga.numero_riferimento_norm;
  }
  if (protocollo) aggiornamento.numero_protocollo = protocollo;

  const attuale = riga as unknown as Record<string, unknown>;
  const cambia = Object.entries(aggiornamento).some(
    ([campo, valore]) => !uguale(attuale[campo], valore)
  );
  return cambia ? aggiornamento : null;
}

export async function sincronizzaSpedizioniGestionali(
  spedizioni: SpedizioneLogica[],
  dettagli = new Map<number, DettaglioDocumento>()
): Promise<void> {
  const valide = spedizioni.filter((spedizione) => spedizione.dataDocumento);
  if (valide.length === 0) return;

  const admin = createAdminClient();
  const { data: codiciData, error: codiciError } = await admin
    .schema("vettori")
    .from("codici_gestionale")
    .select("codice_gestionale,ragione_sociale,vettore_id,tipo,regola_testo,nascondi_bolle");
  if (codiciError) throw new Error(codiciError.message);
  const codiciGestionali = new Map(
    ((codiciData ?? []) as unknown as Array<{
      codice_gestionale: string;
      ragione_sociale: string;
      vettore_id: string | null;
      tipo: CodiceGestionaleVettore["tipo"];
      regola_testo: string | null;
      nascondi_bolle: boolean | null;
    }>).map((riga): [string, CodiceGestionaleVettore] => [
      riga.codice_gestionale.trim().toUpperCase(),
      {
        codiceGestionale: riga.codice_gestionale,
        ragioneSociale: riga.ragione_sociale,
        vettoreId: riga.vettore_id,
        tipo: riga.tipo,
        regolaTesto: riga.regola_testo,
        nascondiBolle: riga.nascondi_bolle === true,
      },
    ])
  );

  for (const blocco of aBlocchi(valide, PER_BLOCCO)) {
    await fondiBlocco(admin, blocco, dettagli, codiciGestionali);
  }
}

/**
 * Fonde un blocco di spedizioni logiche.
 *
 * I legami e le righe attuali si leggono una volta per blocco invece che una
 * volta per spedizione: 1.402 chiamate per 350 spedizioni diventano una
 * manciata, e con la stessa fusione le scritture avvengono solo dove qualcosa
 * e' cambiato. Il blocco e' piccolo apposta: le righe lette in anticipo non
 * devono invecchiare troppo rispetto a chi modifica una bolla nel frattempo.
 */
async function fondiBlocco(
  admin: ClienteAdmin,
  blocco: SpedizioneLogica[],
  dettagli: Map<number, DettaglioDocumento>,
  codiciGestionali: ReadonlyMap<string, CodiceGestionaleVettore>
): Promise<void> {
  const idDocumenti = [...new Set(blocco.flatMap((spedizione) => spedizione.idDocumenti))];
  const legami = new Map<string, LegameRow>();
  const spedizionePerDocumento = new Map<number, string>();
  for (const parte of aBlocchi(idDocumenti, PER_RICHIESTA)) {
    const { data, error } = await admin
      .schema("vettori")
      .from("spedizioni_documenti")
      .select("spedizione_id,id_documento,codice_profilo,tipo_registro,numero_progressivo,numero_documento")
      .in("id_documento", parte);
    if (error) throw new Error(error.message);
    for (const legame of (data ?? []) as unknown as LegameRow[]) {
      legami.set(`${legame.spedizione_id}|${legame.id_documento}`, legame);
      if (!spedizionePerDocumento.has(legame.id_documento)) {
        spedizionePerDocumento.set(legame.id_documento, legame.spedizione_id);
      }
    }
  }

  const righe = new Map<string, SpedizioneRow>();
  for (const parte of aBlocchi([...new Set(spedizionePerDocumento.values())], PER_RICHIESTA)) {
    const { data, error } = await admin
      .schema("vettori")
      .from("spedizioni")
      .select(COLONNE_SPEDIZIONE)
      .in("id", parte);
    if (error) throw new Error(error.message);
    for (const riga of (data ?? []) as unknown as SpedizioneRow[]) righe.set(riga.id, riga);
  }

  for (const spedizione of blocco) {
    const idDocumentiSpedizione = spedizione.idDocumenti;
    let spedizioneId = idDocumentiSpedizione
      .map((idDocumento) => spedizionePerDocumento.get(idDocumento))
      .find((id): id is string => Boolean(id));
    let riga = spedizioneId ? righe.get(spedizioneId) : undefined;

    if (!spedizioneId && spedizione.riferimentoNorm) {
      let cerca = admin
        .schema("vettori")
        .from("spedizioni")
        .select(COLONNE_SPEDIZIONE)
        .eq("direzione", spedizione.direzione)
        .eq("numero_riferimento_norm", spedizione.riferimentoNorm)
        .eq("data_documento", spedizione.dataDocumento as string);
      // Due clienti diversi possono avere lo stesso numero nello stesso giorno
      // (il 25/09/2026 due BC «2694»): senza guardare la controparte la seconda
      // bolla adottava la riga della prima e le due si sovrascrivevano a ogni
      // fusione. Restano adottabili le righe senza controparte, cioe' quelle
      // importate dai fogli Excel: e' il caso per cui il riuso esiste.
      const codice = spedizione.codiceControparte;
      if (codice && /^[\w.-]+$/.test(codice)) {
        cerca = cerca.or(`controparte_codice.is.null,controparte_codice.eq.${codice}`);
      }
      const { data: candidati, error: candidatiError } = await cerca
        .order("creata_il", { ascending: true })
        .limit(2);
      if (candidatiError) throw new Error(candidatiError.message);
      if ((candidati ?? []).length === 1) {
        riga = (candidati as unknown as SpedizioneRow[])[0];
        spedizioneId = riga.id;
      }
    }

    const risoluzioneVettore = risolviVettoreGestionale(
      spedizione.vettoreCodice,
      codiciGestionali
    );
    const valori = valoriGestionali(spedizione, risoluzioneVettore.vettoreId);

    if (!spedizioneId) {
      const { data: nuova, error: insertError } = await admin
        .schema("vettori")
        .from("spedizioni")
        .insert({
          ...valori,
          numero_protocollo: protocolloDaDocumenti(spedizione, dettagli),
          origine: "gestionale",
          stato: codiciGestionali.get((spedizione.vettoreCodice ?? "").trim().toUpperCase())?.nascondiBolle
            ? "ignorata"
            : "attesa",
        })
        .select(COLONNE_SPEDIZIONE)
        .single();
      if (insertError) throw new Error(insertError.message);
      riga = nuova as unknown as SpedizioneRow;
      spedizioneId = riga.id;
    }

    if (!riga) {
      // Legata ma non letta in anticipo: e' stata creata o cancellata nel frattempo.
      const { data: corrente, error: correnteError } = await admin
        .schema("vettori")
        .from("spedizioni")
        .select(COLONNE_SPEDIZIONE)
        .eq("id", spedizioneId)
        .single();
      if (correnteError) throw new Error(correnteError.message);
      riga = corrente as unknown as SpedizioneRow;
    }

    const legamiDaScrivere = idDocumentiSpedizione
      .map((idDocumento) => {
        const dettaglio = dettagli.get(idDocumento);
        return {
          spedizione_id: spedizioneId as string,
          id_documento: idDocumento,
          codice_profilo: dettaglio?.codiceProfilo ?? null,
          tipo_registro: dettaglio?.tipoRegistro ?? null,
          numero_progressivo: dettaglio?.numeroProgressivo ?? null,
          numero_documento: dettaglio?.numeroDocumento ?? null,
        };
      })
      .filter((voluto) => {
        const attuale = legami.get(`${voluto.spedizione_id}|${voluto.id_documento}`);
        return (
          !attuale ||
          !uguale(attuale.codice_profilo, voluto.codice_profilo) ||
          !uguale(attuale.tipo_registro, voluto.tipo_registro) ||
          !uguale(attuale.numero_progressivo, voluto.numero_progressivo) ||
          !uguale(attuale.numero_documento, voluto.numero_documento)
        );
      });
    if (legamiDaScrivere.length > 0) {
      const { error: linkError } = await admin
        .schema("vettori")
        .from("spedizioni_documenti")
        .upsert(legamiDaScrivere, { onConflict: "spedizione_id,id_documento" });
      if (linkError) throw new Error(linkError.message);
      for (const scritto of legamiDaScrivere) {
        legami.set(`${scritto.spedizione_id}|${scritto.id_documento}`, scritto);
      }
    }

    if (riga.congelata) {
      const differenze = differenzeGestionali(riga, valori);
      if (Object.keys(differenze).length === 0) {
        differenze.arrivo_documento = {
          spedizione: "valori congelati conservati",
          gestionale: "documento collegato dopo il controllo",
        };
      }
      const adesso = new Date().toISOString();
      const { error: scostamentoError } = await admin
        .schema("vettori")
        .from("spedizioni_scostamenti")
        .upsert(
          idDocumentiSpedizione.map((idDocumento) => ({
            spedizione_id: spedizioneId,
            id_documento: idDocumento,
            differenze,
            aggiornato_il: adesso,
          })),
          { onConflict: "spedizione_id,id_documento,tipo" }
        );
      if (scostamentoError) throw new Error(scostamentoError.message);
      continue;
    }

    const aggiornamento = pianificaAggiornamentoSpedizione(
      riga,
      valori,
      protocolloDaDocumenti(spedizione, dettagli)
    );
    if (!aggiornamento) continue;
    const { error: updateError } = await admin
      .schema("vettori")
      .from("spedizioni")
      .update({ ...aggiornamento, aggiornata_il: new Date().toISOString() })
      .eq("id", spedizioneId);
    if (updateError) throw new Error(updateError.message);
    // Un'altra spedizione logica dello stesso blocco puo' risolversi sulla
    // stessa riga: deve vedere lo stato aggiornato, non quello letto prima.
    righe.set(spedizioneId, { ...riga, ...aggiornamento } as SpedizioneRow);
  }
}

/**
 * Le testate recenti del gestionale, fuse nelle spedizioni operative.
 *
 * La pagina Bolle lo chiama a ogni lettura (apertura, ricerca, filtro, «carica
 * altri», e dopo ogni salvataggio una volta per pagina aperta). Rifondere 500
 * documenti costava circa 4 secondi e 1.400 chiamate ogni volta, anche quando
 * il gestionale non aveva mandato niente di nuovo: misurato il 29/09/2026.
 *
 * Ora si guarda prima se il grezzo e' cambiato (una query): se l'ultimo
 * `aggiornato_il` dei documenti e dei codici vettore e' lo stesso dell'ultima
 * fusione, non c'e' niente da fondere. Per non fidarsi in eterno, si rifonde
 * comunque ogni 10 minuti. Piu' richieste contemporanee aspettano la stessa
 * fusione invece di lanciarne una ciascuna.
 */
const RINNOVO_FUSIONE_MS = 10 * 60 * 1000;
let ultimaFusione: { marca: string; alle: number } | null = null;
let fusioneInCorso: Promise<void> | null = null;

export function dimenticaUltimaFusione(): void {
  ultimaFusione = null;
}

export function fondiDocumentiRecenti(): Promise<void> {
  if (!fusioneInCorso) {
    fusioneInCorso = eseguiFusioneRecenti().finally(() => {
      fusioneInCorso = null;
    });
  }
  return fusioneInCorso;
}

async function eseguiFusioneRecenti(): Promise<void> {
  const admin = createAdminClient();
  const ultimo = async (schema: "bi" | "vettori", tabella: string) => {
    const { data, error } = await admin
      .schema(schema)
      .from(tabella)
      .select("aggiornato_il")
      .order("aggiornato_il", { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return ((data ?? [])[0] as { aggiornato_il?: string | null } | undefined)?.aggiornato_il ?? null;
  };
  const [documenti, codici] = await Promise.all([
    ultimo("bi", "trasporti_documenti"),
    ultimo("vettori", "codici_gestionale"),
  ]);
  const marca = documenti ? `${documenti}|${codici ?? ""}` : null;
  if (
    marca &&
    ultimaFusione &&
    ultimaFusione.marca === marca &&
    Date.now() - ultimaFusione.alle < RINNOVO_FUSIONE_MS
  ) {
    return;
  }

  // La pipeline scrive soltanto il grezzo in `bi`. 500 documenti coprono
  // ampiamente la finestra di lavoro al banco senza rileggere lo storico.
  const { data, error } = await admin
    .schema("bi")
    .from("trasporti_documenti")
    .select(
      "id_documento,codice_profilo,tipo_registro,numero_progressivo,numero_documento,data_documento,data_registrazione,id_sog_commerciale,codice_soggetto,soggetto,zona_cap,zona_provincia,fonte_zona,tipo_trasporto_codice,tipo_trasporto,tras_mezzo,vettore_codice,vettore,num_colli,peso_netto,peso_lordo,volume,asp_beni"
    )
    .order("data_creazione", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(error.message);
  await sincronizzaBolleGestionali((data ?? []) as unknown as BollaGestionale[]);
  // La marca e' letta PRIMA della fusione: se il grezzo cambia nel frattempo,
  // la prossima richiesta se ne accorge e rifonde.
  ultimaFusione = marca ? { marca, alle: Date.now() } : null;
}
