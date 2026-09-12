import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BollaGestionale, SpedizioneLogica } from "./abbinamento";
import { raggruppaInSpedizioni } from "./abbinamento";
import { normalizzaRiferimento } from "./fatture/testo";
import { volumeGruppoM3 } from "./misure";
import type {
  CampiBollaForzati,
  CampoBollaForzabile,
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
  campi_forzati: unknown;
  congelata: boolean;
}

interface DettaglioDocumento {
  codiceProfilo: string | null;
  tipoRegistro: string | null;
  numeroProgressivo: string | null;
  numeroDocumento: string | null;
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
    if (!congelata && !forzati[campo]) aggiornamenti[campo] = gestionali[campo];
  }
  return { aggiornamenti, differenze };
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

export async function sincronizzaSpedizioniGestionali(
  spedizioni: SpedizioneLogica[],
  dettagli = new Map<number, DettaglioDocumento>()
): Promise<void> {
  const valide = spedizioni.filter((spedizione) => spedizione.dataDocumento);
  if (valide.length === 0) return;

  const admin = createAdminClient();
  const { data: vettoriData, error: vettoriError } = await admin
    .schema("vettori")
    .from("vettori")
    .select("id,codice");
  if (vettoriError) throw new Error(vettoriError.message);
  const vettori = new Map(
    ((vettoriData ?? []) as unknown as Array<{ id: string; codice: string }>).map((riga) => [
      riga.codice.toLowerCase(),
      riga.id,
    ])
  );

  for (const spedizione of valide) {
    const idDocumenti = spedizione.idDocumenti;
    const { data: legami, error: legamiError } = await admin
      .schema("vettori")
      .from("spedizioni_documenti")
      .select("spedizione_id")
      .in("id_documento", idDocumenti)
      .limit(1);
    if (legamiError) throw new Error(legamiError.message);

    let spedizioneId = (legami?.[0] as { spedizione_id?: string } | undefined)?.spedizione_id;
    if (!spedizioneId && spedizione.riferimentoNorm) {
      const { data: candidati, error: candidatiError } = await admin
        .schema("vettori")
        .from("spedizioni")
        .select("id")
        .eq("direzione", spedizione.direzione)
        .eq("numero_riferimento_norm", spedizione.riferimentoNorm)
        .eq("data_documento", spedizione.dataDocumento as string)
        .order("creata_il", { ascending: true })
        .limit(2);
      if (candidatiError) throw new Error(candidatiError.message);
      if ((candidati ?? []).length === 1) {
        spedizioneId = (candidati?.[0] as { id: string }).id;
      }
    }

    const vettoreId = spedizione.vettoreCodice
      ? vettori.get(spedizione.vettoreCodice.toLowerCase()) ?? null
      : null;
    const valori = valoriGestionali(spedizione, vettoreId);

    if (!spedizioneId) {
      const { data: nuova, error: insertError } = await admin
        .schema("vettori")
        .from("spedizioni")
        .insert({ ...valori, origine: "gestionale", stato: "attesa" })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      spedizioneId = (nuova as { id: string }).id;
    }

    const legamiDaInserire = idDocumenti.map((idDocumento) => {
      const dettaglio = dettagli.get(idDocumento);
      return {
        spedizione_id: spedizioneId,
        id_documento: idDocumento,
        codice_profilo: dettaglio?.codiceProfilo ?? null,
        tipo_registro: dettaglio?.tipoRegistro ?? null,
        numero_progressivo: dettaglio?.numeroProgressivo ?? null,
        numero_documento: dettaglio?.numeroDocumento ?? null,
      };
    });
    const { error: linkError } = await admin
      .schema("vettori")
      .from("spedizioni_documenti")
      .upsert(legamiDaInserire, { onConflict: "spedizione_id,id_documento" });
    if (linkError) throw new Error(linkError.message);

    const { data: corrente, error: correnteError } = await admin
      .schema("vettori")
      .from("spedizioni")
      .select("id,direzione,vettore_id,numero_riferimento,numero_riferimento_norm,data_documento,controparte_codice,controparte_nome,zona_cap,zona_provincia,fonte_zona,porto_codice,porto_descrizione,a_nostro_carico,colli_bolla,peso_bolla,origine,campi_forzati,congelata")
      .eq("id", spedizioneId)
      .single();
    if (correnteError) throw new Error(correnteError.message);
    const riga = corrente as unknown as SpedizioneRow;

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
          idDocumenti.map((idDocumento) => ({
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

    const forzati = campiForzatiDaDb(riga.campi_forzati);
    const aggiornamento: Record<string, unknown> = {
      ...valori,
      origine: riga.origine,
      aggiornata_il: new Date().toISOString(),
    };
    for (const campo of CAMPI_BOLLA_FORZABILI) {
      if (forzati[campo]) aggiornamento[campo] = valoreRiga(riga, campo);
    }
    if (forzati.numero_riferimento) {
      aggiornamento.numero_riferimento_norm = riga.numero_riferimento_norm;
    }
    const { error: updateError } = await admin
      .schema("vettori")
      .from("spedizioni")
      .update(aggiornamento)
      .eq("id", spedizioneId);
    if (updateError) throw new Error(updateError.message);
  }
}
