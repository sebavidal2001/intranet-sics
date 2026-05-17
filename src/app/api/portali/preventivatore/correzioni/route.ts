import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

// Whitelist livelli che possono modificare i totals di un documento.
const ADMIN_LEVELS = new Set(["admin", "superadmin", "exporter"]);

interface PatchTotals {
  totale_materiale?: number | null;
  ricarico_materiale_coeff?: number | null;
  totale_manodopera?: number | null;
  ricarico_manodopera_coeff?: number | null;
  imballo?: number | null;
  tempi_accessori?: number | null;
  spese_generali?: number | null;
  variabili_progettuali?: number | null;
  totale_costi?: number | null;
  totale?: number | null;
  margine_trattativa?: number | null;
  prezzo_finale?: number | null;
}

interface PatchBody {
  documento_id: string;
  importo_preventivo?: number | null;
  chunk_id?: string;            // se specificato, aggiorna i totals di quel chunk
  totals_patch?: PatchTotals;   // valori da applicare/sovrascrivere
  tipo_prodotto?: string;
  categoria?: string;
}

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
    if (!ADMIN_LEVELS.has(livello)) {
      return NextResponse.json(
        { error: "Solo admin/exporter possono modificare i totali." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as PatchBody;
    if (!body.documento_id || !/^[0-9a-f-]{36}$/i.test(body.documento_id)) {
      return NextResponse.json({ error: "documento_id non valido" }, { status: 400 });
    }

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
    console.error("Correzioni POST error:", err);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
