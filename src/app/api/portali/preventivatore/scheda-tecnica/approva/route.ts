import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { haRuoloFunzionale, PREVENTIVATORE_RUOLI } from "@/lib/portali/preventivatore/ruoli";
import { getCachedEmbedding } from "@/lib/portali/preventivatore/chat/embedding-cache";
import { logError, logWarn } from "@/lib/logger";
import { MAX_CARATTERI_SCHEDA } from "@/lib/portali/preventivatore/scheda-tecnica/ai";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scheda_id: z.string().uuid("scheda_id non valido"),
  contenuto_md: z.string().trim().min(1, "contenuto_md obbligatorio").max(MAX_CARATTERI_SCHEDA),
  builder_state: z.unknown().optional(),
  n_revisioni: z.number().int().min(0).max(10_000).optional(),
}).superRefine((value, ctx) => {
  if (value.builder_state !== undefined && Buffer.byteLength(JSON.stringify(value.builder_state), "utf8") > 200_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["builder_state"], message: "builder_state supera 200 KB" });
  }
});

function datiCliente(builderState: unknown): { titolo: string | null; cliente: string | null; clienteMasterId: string | null } {
  if (!builderState || typeof builderState !== "object") return { titolo: null, cliente: null, clienteMasterId: null };
  const state = builderState as Record<string, unknown>;
  const clienteRaw = state.cliente;
  const cliente = clienteRaw && typeof clienteRaw === "object" ? clienteRaw as Record<string, unknown> : null;
  return {
    titolo: typeof state.titolo === "string" ? state.titolo : null,
    cliente: typeof cliente?.ragione_sociale === "string" ? cliente.ragione_sociale : null,
    clienteMasterId: typeof cliente?.id === "string" ? cliente.id : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user, ctx } = guard;
    if (!haRuoloFunzionale(ctx, [PREVENTIVATORE_RUOLI.preventivatore])) {
      return NextResponse.json({ error: "Non autorizzato ad approvare schede" }, { status: 403 });
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payload non valido" }, { status: 400 });
    }
    const body = parsed.data;
    const admin = createAdminClient();
    const { data: scheda, error: schedaError } = await admin.schema("preventivatore").from("schede_generate")
      .select("id, user_id, builder_state")
      .eq("id", body.scheda_id)
      .maybeSingle();
    if (schedaError) throw schedaError;
    if (!scheda) return NextResponse.json({ error: "Scheda non trovata" }, { status: 404 });
    if ((scheda as { user_id: string | null }).user_id !== user.id) {
      return NextResponse.json({ error: "Scheda non appartenente all'utente" }, { status: 403 });
    }

    const contenuto = body.contenuto_md.trim();
    const state = body.builder_state ?? (scheda as { builder_state: unknown }).builder_state;
    const { titolo, cliente, clienteMasterId } = datiCliente(state);
    let embedding: number[] | null = null;
    try {
      embedding = await getCachedEmbedding(contenuto.slice(0, 8_000));
    } catch (error) {
      logWarn("preventivatore.scheda-tecnica", "embedding scheda approvata fallito", { dettaglio: String(error) });
    }

    const verificata = ctx.livello === "admin" || ctx.livello === "superadmin";
    const payload = {
      scheda_id: body.scheda_id,
      titolo,
      cliente,
      cliente_master_id: clienteMasterId,
      tipo_prodotto: titolo,
      contenuto_md: contenuto,
      embedding,
      n_revisioni: body.n_revisioni ?? 0,
      approvata_da: user.id,
      verificata,
    };

    const { data: esistente, error: esistenteError } = await admin.schema("preventivatore").from("schede_approvate")
      .select("id").eq("scheda_id", body.scheda_id).maybeSingle();
    if (esistenteError) throw esistenteError;
    const query = esistente
      ? admin.schema("preventivatore").from("schede_approvate").update(payload).eq("id", esistente.id).select("id").single()
      : admin.schema("preventivatore").from("schede_approvate").insert(payload).select("id").single();
    const { data: row, error } = await query;
    if (error) {
      logError("preventivatore.scheda-tecnica", "salvataggio scheda approvata fallito", error);
      return NextResponse.json({ error: "Errore salvataggio esempio approvato" }, { status: 500 });
    }

    const { error: updateError } = await admin.schema("preventivatore").from("schede_generate")
      .update({ approvata_il: new Date().toISOString(), contenuto_md: contenuto })
      .eq("id", body.scheda_id)
      .eq("user_id", user.id);
    if (updateError) logWarn("preventivatore.scheda-tecnica", "marcatura approvata_il fallita", { dettaglio: updateError.message });

    return NextResponse.json({
      ok: true,
      id: (row as { id: string }).id,
      aggiornata: Boolean(esistente),
      indicizzata: embedding !== null,
      verificata,
    });
  } catch (err) {
    logError("preventivatore.scheda-tecnica", "approva scheda error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Errore approvazione scheda" }, { status: 500 });
  }
}
