import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { determinaProvincia, risolviCap } from "@/lib/portali/vettori/cap";
import { normalizzaRiferimento } from "@/lib/portali/vettori/fatture/testo";
import type { ConfermaSimulazione } from "@/lib/portali/vettori/tipi";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const CONDIZIONI = [
  "bancale",
  "non_sovrapponibile",
  "movimentazione_manuale",
  "oversized",
  "ztl",
  "etichetta_manuale",
  "triangolazione",
  "fuori_provincia",
  "giacenza",
  "assegno",
] as const;

const Gruppo = z.object({
  quantita: z.number().int().min(1).max(999),
  lunghezzaCm: z.number().positive().max(2000),
  larghezzaCm: z.number().positive().max(2000),
  altezzaCm: z.number().positive().max(2000),
  pesoRealeKg: z.number().positive().max(100_000).nullable().optional(),
}).strict();

const VoceCalcolo = z.object({
  codice: z.string(),
  descrizione: z.string(),
  importo: z.number().finite(),
}).strict();

const Costo = z.object({
  pesoReale: z.number().min(0),
  pesoVolumetrico: z.number().min(0),
  pesoTassabile: z.number().min(0),
  pesoApplicato: z.enum(["reale", "volumetrico", "minimo"]),
  nolo: z.number().min(0),
  fasciaDescrizione: z.string(),
  supplementi: z.array(VoceCalcolo),
  imponibileNolo: z.number().min(0),
  adeguamento: z.number().min(0),
  carburante: z.number().min(0),
  fuoriBase: z.number().min(0),
  totale: z.number().min(0),
  avvertenze: z.array(z.string()),
}).strict();

const Riaddebito = z.object({
  importo: z.number().min(0).nullable(),
  pesoUsato: z.number().min(0),
  basePeso: z.enum(["reale", "tassabile"]),
  regola: z.string(),
  avvertenza: z.string().nullable(),
}).strict();

const Esito = z.object({
  vettoreId: z.string().uuid(),
  vettoreCodice: z.string().min(1),
  vettoreNome: z.string().min(1),
  disponibile: z.boolean(),
  motivoIndisponibilita: z.string().optional(),
  listino: z.object({
    etichetta: z.string(),
    validoDal: z.string().date(),
    validoAl: z.string().date().nullable(),
  }).strict().nullable().optional(),
  calcolo: Costo.optional(),
  differenzaDalMigliore: z.number().finite().optional(),
  riaddebito: Riaddebito.optional(),
  margine: z.number().finite().nullable().optional(),
}).strict();

const Simulazione = z.object({
  direzione: z.enum(["entrata", "uscita"]).default("uscita"),
  cap: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  provincia: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
  fonteProvincia: z.enum(["cap", "prefisso", "manuale"]).nullable().optional(),
  controparteCodice: z.string().trim().min(1).max(100).nullable().optional(),
  colli: z.number().int().min(1).max(999),
  pesoKg: z.number().positive().max(100_000),
  gruppi: z.array(Gruppo).max(999).default([]),
  lunghezzaCm: z.number().positive().max(2000).nullable().optional(),
  larghezzaCm: z.number().positive().max(2000).nullable().optional(),
  altezzaCm: z.number().positive().max(2000).nullable().optional(),
  data: z.string().date(),
  condizioni: z.array(z.enum(CONDIZIONI)).max(CONDIZIONI.length).default([]),
  vettoreSceltoId: z.string().uuid(),
  costoPrevisto: z.number().min(0),
  riaddebitoPrevisto: z.number().min(0).nullable(),
  esiti: z.array(Esito).min(1).max(100),
}).strict();

const Body = z.object({
  simulazione: Simulazione,
  bolla: z.object({
    numeroRiferimento: z.string().trim().min(1).max(200).nullable(),
    dataDocumento: z.string().date(),
    controparteNome: z.string().trim().min(1).max(500),
    controparteCodice: z.string().trim().min(1).max(100).nullable(),
  }).strict(),
}).strict();

interface MisuraDb {
  quantita: number;
  lunghezza_cm: number;
  larghezza_cm: number;
  altezza_cm: number;
  peso_reale_kg: number | null;
  volume_m3: number;
}

function misureDaInput(input: z.infer<typeof Simulazione>): MisuraDb[] {
  const gruppi = input.gruppi.length > 0
    ? input.gruppi
    : input.lunghezzaCm && input.larghezzaCm && input.altezzaCm
      ? [{
          quantita: input.colli,
          lunghezzaCm: input.lunghezzaCm,
          larghezzaCm: input.larghezzaCm,
          altezzaCm: input.altezzaCm,
          pesoRealeKg: null,
        }]
      : [];
  return gruppi.map((gruppo) => ({
    quantita: gruppo.quantita,
    lunghezza_cm: gruppo.lunghezzaCm,
    larghezza_cm: gruppo.larghezzaCm,
    altezza_cm: gruppo.altezzaCm,
    peso_reale_kg: gruppo.pesoRealeKg ?? null,
    volume_m3: Number((
      gruppo.quantita * gruppo.lunghezzaCm * gruppo.larghezzaCm * gruppo.altezzaCm / 1_000_000
    ).toFixed(6)),
  }));
}

async function agganciaMisure(
  spedizioneId: string,
  misure: MisuraDb[],
  utenteId: string
): Promise<void> {
  if (misure.length === 0) return;
  const admin = createAdminClient();
  // Se la bolla era gia' stata misurata, duplicare i gruppi gonfierebbe il
  // volumetrico. In quel caso preserviamo le misure operative esistenti.
  const { data: esistenti, error: letturaError } = await admin
    .schema("vettori")
    .from("bolla_misure")
    .select("id")
    .eq("spedizione_id", spedizioneId)
    .limit(1);
  if (letturaError) throw new Error(letturaError.message);
  if ((esistenti ?? []).length > 0) return;

  const { error } = await admin.schema("vettori").from("bolla_misure").insert(
    misure.map((misura) => ({
      ...misura,
      spedizione_id: spedizioneId,
      fonte: "manuale",
      inserito_da: utenteId,
      modificato_da: utenteId,
    }))
  );
  if (error) throw new Error(error.message);
}

/** Conferma la decisione e collega le misure alla spedizione, nuova o gia esistente. */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori();
    if (!guard.ok) return guard.response;
    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }
    const parsed = Body.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi.", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { simulazione, bolla } = parsed.data;
    const colliNeiGruppi = simulazione.gruppi.reduce(
      (totale, gruppo) => totale + gruppo.quantita,
      0
    );
    if (simulazione.gruppi.length > 0 && colliNeiGruppi !== simulazione.colli) {
      return NextResponse.json(
        {
          error: `I colli dichiarati sono ${simulazione.colli}, ma la somma delle quantita dei gruppi e ${colliNeiGruppi}.`,
        },
        { status: 400 }
      );
    }
    const scelto = simulazione.esiti.find(
      (esito) => esito.vettoreId === simulazione.vettoreSceltoId
    );
    if (!scelto?.disponibile) {
      return NextResponse.json(
        { error: "Il vettore scelto non risulta disponibile nella simulazione." },
        { status: 400 }
      );
    }

    const cap = simulazione.cap ?? null;
    const esitoCap = cap ? await risolviCap(cap) : null;
    const destinazione = cap
      ? determinaProvincia(esitoCap, simulazione.provincia)
      : determinaProvincia(null, simulazione.provincia);
    if (destinazione.estero) {
      return NextResponse.json(
        { error: "Una destinazione internazionale richiede una quotazione separata." },
        { status: 400 }
      );
    }

    const numero = bolla.numeroRiferimento;
    const riferimentoNorm = normalizzaRiferimento(numero);
    if (numero !== null && riferimentoNorm === null) {
      return NextResponse.json(
        { error: "Il numero bolla deve contenere almeno una lettera o una cifra significativa." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    let spedizioneEsistente: string | null = null;
    // Questa ricerca deve precedere la RPC di creazione: la terna e' la chiave
    // con cui arrivera' anche il gestionale, e duplicarla separa misure e fattura.
    if (riferimentoNorm !== null) {
      const { data: esistenti, error } = await admin
        .schema("vettori")
        .from("spedizioni")
        .select("id")
        .eq("direzione", simulazione.direzione)
        .eq("numero_riferimento_norm", riferimentoNorm)
        .eq("data_documento", bolla.dataDocumento)
        .limit(1);
      if (error) throw new Error(error.message);
      spedizioneEsistente = ((esistenti ?? []) as Array<{ id: string }>)[0]?.id ?? null;
    }

    const { data: simulazioneData, error: simulazioneError } = await admin
      .schema("vettori")
      .from("simulazioni")
      .insert({
        eseguita_da: guard.user.id,
        data_riferimento: simulazione.data,
        direzione: simulazione.direzione,
        cap,
        provincia: destinazione.provincia,
        fonte_provincia: destinazione.fonteProvincia,
        colli: simulazione.colli,
        peso_kg: simulazione.pesoKg,
        condizioni: simulazione.condizioni,
        gruppi: simulazione.gruppi,
        esiti: simulazione.esiti,
        vettore_scelto_id: simulazione.vettoreSceltoId,
        costo_previsto: simulazione.costoPrevisto,
        riaddebito_previsto: simulazione.riaddebitoPrevisto,
        spedizione_id: spedizioneEsistente,
      })
      .select("id")
      .single();
    if (simulazioneError) throw new Error(simulazioneError.message);
    const simulazioneId = (simulazioneData as { id: string }).id;
    const misure = misureDaInput(simulazione);

    if (spedizioneEsistente) {
      await agganciaMisure(spedizioneEsistente, misure, guard.user.id);
      const risposta: ConfermaSimulazione = {
        simulazioneId,
        spedizioneId: spedizioneEsistente,
        daNumerare: false,
      };
      return NextResponse.json(risposta, { status: 201 });
    }

    const payload = {
      direzione: simulazione.direzione,
      vettore_id: simulazione.vettoreSceltoId,
      numero_riferimento: numero,
      numero_riferimento_norm: riferimentoNorm,
      data_documento: bolla.dataDocumento,
      controparte_codice: bolla.controparteCodice ?? simulazione.controparteCodice ?? null,
      controparte_nome: bolla.controparteNome,
      zona_cap: cap,
      zona_provincia: destinazione.provincia,
      fonte_zona: destinazione.fonteProvincia,
      colli_bolla: simulazione.colli,
      peso_bolla: simulazione.pesoKg,
      origine: "simulazione",
      utente_id: guard.user.id,
      fonte_misure: "manuale",
      misure,
    };
    const { data: spedizioneId, error: creazioneError } = await admin
      .schema("vettori")
      .rpc("crea_bolla_manuale", { p_payload: payload });
    if (creazioneError) throw new Error(creazioneError.message);
    if (typeof spedizioneId !== "string") {
      throw new Error("La bolla e stata creata senza identificativo.");
    }

    const { error: collegamentoError } = await admin
      .schema("vettori")
      .from("simulazioni")
      .update({ spedizione_id: spedizioneId })
      .eq("id", simulazioneId);
    if (collegamentoError) throw new Error(collegamentoError.message);

    const risposta: ConfermaSimulazione = {
      simulazioneId,
      spedizioneId,
      daNumerare: numero === null,
    };
    return NextResponse.json(risposta, { status: 201 });
  } catch (error) {
    logError("vettori.simulazioni", "conferma simulazione fallita", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Non e stato possibile confermare la simulazione." },
      { status: 500 }
    );
  }
}
