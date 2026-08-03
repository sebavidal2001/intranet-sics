import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { haRuoloFunzionaleAsync, PREVENTIVATORE_RUOLI } from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Whitelist livelli che possono modificare i totals di un documento.
// `exporter` è escluso: per definizione (vedi src/lib/auth/portale.ts) è
// "visualizza + scarica PDF/CSV, nessuna modifica strutturale", mentre qui si
// riscrivono importi e margini. Chi deve correggere i totali è admin del
// portale, oppure ha il ruolo funzionale preventivatore (controllato sotto).
const ADMIN_LEVELS = new Set(["admin", "superadmin"]);

// Validazione a runtime del payload: qui si riscrivono importi e margini di un
// preventivo, quindi un cast a interfaccia TypeScript (che a runtime non
// controlla nulla) non basta. Limiti coerenti con `documenti/[id]/stato`.
const ImportoOpzionale = z.number().finite().min(-100_000_000).max(100_000_000).nullable().optional();

const TotalsPatchSchema = z.object({
  totale_materiale: ImportoOpzionale,
  ricarico_materiale_coeff: z.number().finite().min(0).max(1000).nullable().optional(),
  totale_manodopera: ImportoOpzionale,
  ricarico_manodopera_coeff: z.number().finite().min(0).max(1000).nullable().optional(),
  imballo: ImportoOpzionale,
  tempi_accessori: ImportoOpzionale,
  spese_generali: ImportoOpzionale,
  variabili_progettuali: ImportoOpzionale,
  totale_costi: ImportoOpzionale,
  totale: ImportoOpzionale,
  margine_trattativa: ImportoOpzionale,
  prezzo_finale: ImportoOpzionale,
});

const PatchBodySchema = z.object({
  documento_id: z.string().uuid("documento_id non valido"),
  importo_preventivo: ImportoOpzionale,
  chunk_id: z.string().uuid().optional(),
  totals_patch: TotalsPatchSchema.optional(),
  tipo_prodotto: z.string().trim().max(120).optional(),
  categoria: z.string().trim().max(120).optional(),
});

type PatchBody = z.infer<typeof PatchBodySchema>;

function num(v: unknown): { raw: number; ceil_2: number } | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return { raw: n, ceil_2: Math.ceil((n - Number.EPSILON) * 100) / 100 };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    const puoCorreggere =
      ADMIN_LEVELS.has(livello) ||
      (await haRuoloFunzionaleAsync(user.id, livello, [PREVENTIVATORE_RUOLI.preventivatore]));
    if (!puoCorreggere) {
      return NextResponse.json(
        { error: "Per modificare i totali serve il ruolo 'preventivatore' o i permessi di admin." },
        { status: 403 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = PatchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const body: PatchBody = parsed.data;

    const admin = createAdminClient().schema("preventivatore");

    // 1) Aggiorna i totals del chunk specifico se richiesto
    if (body.chunk_id && body.totals_patch) {
      const { data: chunkRow, error: cErr } = await admin
        .from("chunks")
        .select("id, metadata")
        .eq("id", body.chunk_id)
        .eq("documento_id", body.documento_id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!chunkRow) return NextResponse.json({ error: "Chunk non trovato" }, { status: 404 });

      const meta = (chunkRow.metadata as Record<string, unknown>) ?? {};
      const oldTotals = (meta.totals as Record<string, unknown>) ?? {};
      const newTotals: Record<string, unknown> = { ...oldTotals };

      const patch = body.totals_patch;
      const setOrDelete = (k: string, v: unknown) => {
        if (v === null || v === undefined) {
          delete newTotals[k];
        } else {
          newTotals[k] = v;
        }
      };

      // Mapping coefficienti ricarico → struttura nested
      if (patch.ricarico_materiale_coeff !== undefined) {
        if (patch.ricarico_materiale_coeff === null) delete newTotals.ricarico_materiale;
        else newTotals.ricarico_materiale = { coefficiente_raw: patch.ricarico_materiale_coeff };
      }
      if (patch.ricarico_manodopera_coeff !== undefined) {
        if (patch.ricarico_manodopera_coeff === null) delete newTotals.ricarico_manodopera;
        else newTotals.ricarico_manodopera = { coefficiente_raw: patch.ricarico_manodopera_coeff };
      }

      // Valori scalari
      for (const k of [
        "totale_materiale", "totale_manodopera", "imballo", "tempi_accessori",
        "spese_generali", "variabili_progettuali", "totale_costi", "totale",
        "margine_trattativa", "prezzo_finale",
      ] as const) {
        if (patch[k] !== undefined) setOrDelete(k, num(patch[k]));
      }

      // Backup totals_originale se non esiste già
      const updatedMeta: Record<string, unknown> = {
        ...meta,
        totals: newTotals,
      };
      if (!meta.totals_originale) updatedMeta.totals_originale = oldTotals;
      updatedMeta.totals_correzione_manuale = {
        corretto_il: new Date().toISOString(),
        corretto_da: user.id,
      };

      const { error: uErr } = await admin
        .from("chunks")
        .update({ metadata: updatedMeta })
        .eq("id", chunkRow.id);
      if (uErr) throw uErr;
    }

    // 2) Aggiorna documenti: importo, tipo, categoria + audit
    const docPatch: Record<string, unknown> = {};
    if (body.importo_preventivo !== undefined) {
      docPatch.importo_preventivo = body.importo_preventivo;
      docPatch.importo_finale_raw = body.importo_preventivo;
      docPatch.importo_source = "prezzo_finale_manuale";
    }
    if (body.tipo_prodotto !== undefined) docPatch.tipo_prodotto = body.tipo_prodotto;
    if (body.categoria !== undefined) docPatch.categoria = body.categoria;

    if (Object.keys(docPatch).length > 0) {
      // Aggiungi nota in stato_note
      const { data: prev } = await admin
        .from("documenti")
        .select("stato_note")
        .eq("id", body.documento_id)
        .maybeSingle();
      const noteAttuale = (prev?.stato_note as string | null) ?? "";
      const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
      docPatch.stato_note =
        (noteAttuale ? noteAttuale + "\n" : "") +
        `[${ts}] Correzione manuale UI: ${Object.keys(docPatch).filter(k => k !== "stato_note").join(", ")} (utente ${user.id.slice(0, 8)})`;

      const { error: dErr } = await admin
        .from("documenti")
        .update(docPatch)
        .eq("id", body.documento_id);
      if (dErr) throw dErr;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("preventivatore.correzioni", "Correzioni POST error", err);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
