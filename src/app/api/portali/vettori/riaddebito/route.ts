import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import {
  caricaAccordiRiaddebito,
  caricaVersioneRiaddebito,
} from "@/lib/portali/vettori/riaddebito";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const DataQuery = z.object({
  data: z.string().date().optional(),
}).strict();

const Scaglione = z.object({
  pesoDa: z.number().min(0).max(100_000),
  pesoA: z.number().positive().max(100_000).nullable(),
  importo: z.number().min(0).max(1_000_000).nullable(),
  nota: z.string().trim().max(1000).nullable(),
}).strict().refine(
  (riga) => riga.pesoA === null || riga.pesoA > riga.pesoDa,
  { message: "La soglia finale deve superare quella iniziale.", path: ["pesoA"] }
);

const SalvataggioVersione = z.object({
  validoDal: z.string().date(),
  basePeso: z.enum(["reale", "tassabile"]),
  scaglioni: z.array(Scaglione).min(1).max(100),
}).strict();

const Accordo = z.object({
  id: z.string().uuid().optional(),
  codiceCliente: z.string().trim().min(1).max(100),
  ragioneSociale: z.string().trim().max(500).nullable(),
  validoDal: z.string().date(),
  validoAl: z.string().date().nullable(),
  modalita: z.enum(["tabella", "importo_fisso", "nessun_addebito"]),
  importo: z.number().min(0).max(1_000_000).nullable(),
  nota: z.string().trim().max(1000).nullable(),
}).strict().superRefine((accordo, ctx) => {
  if (accordo.validoAl !== null && accordo.validoAl < accordo.validoDal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "La fine validita non puo precedere l'inizio.",
      path: ["validoAl"],
    });
  }
  if (accordo.modalita === "importo_fisso" && accordo.importo === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "L'importo e obbligatorio per un accordo a importo fisso.",
      path: ["importo"],
    });
  }
});

function oggi(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Versione in vigore e storico degli accordi, riservati all'amministrazione. */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;
    const parsed = DataQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({ error: "Data non valida." }, { status: 400 });
    }
    const [versione, accordi] = await Promise.all([
      caricaVersioneRiaddebito(parsed.data.data ?? oggi()),
      caricaAccordiRiaddebito(),
    ]);
    if (!versione) {
      return NextResponse.json({ error: "Nessuna tabella di riaddebito in vigore." }, { status: 404 });
    }
    return NextResponse.json(
      { versione, accordi },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logError("vettori.riaddebito", "lettura riaddebito fallita", error);
    return NextResponse.json({ error: "Non e stato possibile leggere il riaddebito." }, { status: 500 });
  }
}

/** Salva atomicamente una versione intera degli scaglioni tramite la RPC dedicata. */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;
    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }
    const parsed = SalvataggioVersione.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi.", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin.schema("vettori").rpc(
      "salva_riaddebito_scaglioni",
      {
        p_valido_dal: parsed.data.validoDal,
        p_base_peso: parsed.data.basePeso,
        p_scaglioni: parsed.data.scaglioni.map((riga) => ({
          peso_da: riga.pesoDa,
          peso_a: riga.pesoA,
          importo: riga.importo,
          nota: riga.nota,
        })),
        p_utente_id: guard.user.id,
      }
    );
    if (error) throw new Error(error.message);
    if (typeof data !== "number") {
      throw new Error("La tabella e stata salvata senza il numero di scaglioni.");
    }
    return NextResponse.json({ salvati: data }, { status: 201 });
  } catch (error) {
    logError("vettori.riaddebito", "salvataggio riaddebito fallito", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Non e stato possibile salvare il riaddebito." },
      { status: 500 }
    );
  }
}

/** Il secondo verbo gestisce gli accordi cliente senza confonderli con le versioni generali. */
export async function PUT(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;
    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }
    const parsed = Accordo.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi.", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { id, ...accordo } = parsed.data;
    const valori = {
      codice_cliente: accordo.codiceCliente,
      ragione_sociale: accordo.ragioneSociale,
      valido_dal: accordo.validoDal,
      valido_al: accordo.validoAl,
      modalita: accordo.modalita,
      importo: accordo.modalita === "importo_fisso" ? accordo.importo : null,
      nota: accordo.nota,
      creato_da: guard.user.id,
    };
    const admin = createAdminClient();
    const query = id
      ? admin.schema("vettori").from("riaddebito_clienti").update(valori).eq("id", id)
      : admin.schema("vettori").from("riaddebito_clienti").insert(valori);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: "Accordo cliente non trovato." }, { status: 404 });
    }
    return NextResponse.json({ id: (data as { id: string }).id }, { status: id ? 200 : 201 });
  } catch (error) {
    logError("vettori.riaddebito", "salvataggio accordo fallito", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Non e stato possibile salvare l'accordo." },
      { status: 500 }
    );
  }
}
