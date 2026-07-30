import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { getCachedEmbedding } from "@/lib/portali/preventivatore/chat/embedding-cache";
import type { BuilderStateForChat } from "@/lib/portali/preventivatore/chat/types";
import { logError, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/portali/preventivatore/scheda-tecnica/approva
 *
 * LOOP DI APPRENDIMENTO: quando l'utente scarica/approva una scheda, questa
 * viene salvata in `preventivatore.schede_approvate` con il suo embedding e da
 * quel momento diventa un ESEMPIO DI RIFERIMENTO prioritario per le generazioni
 * successive (vedi `recuperaEsempi` in lib/scheda-tecnica/ai.ts).
 *
 * In pratica: più schede l'azienda approva, più le nuove nascono già nello stile
 * giusto — senza dover riscrivere il prompt ogni volta.
 *
 * Idempotente sulla scheda: ri-approvare la stessa `scheda_id` aggiorna la riga
 * esistente invece di creare duplicati.
 *
 * Body: { scheda_id?, contenuto_md, builder_state?, n_revisioni? }
 */

type RequestBody = {
  scheda_id?: string | null;
  contenuto_md: string;
  builder_state?: BuilderStateForChat;
  n_revisioni?: number;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = (await request.json()) as RequestBody;
    const contenuto = (body?.contenuto_md ?? "").trim();
    if (!contenuto) return NextResponse.json({ error: "contenuto_md obbligatorio" }, { status: 400 });

    const admin = createAdminClient();
    const bs = body.builder_state;
    const titolo = bs?.titolo ?? null;
    const cliente = bs?.cliente?.ragione_sociale ?? null;

    // Embedding del contenuto approvato: è ciò che permetterà di ritrovarla come
    // esempio quando si genererà una scheda per un prodotto simile.
    let embedding: number[] | null = null;
    try {
      embedding = await getCachedEmbedding(contenuto.slice(0, 8000));
    } catch (e) {
      // Senza embedding la scheda resta archiviata ma non sarà recuperabile via RAG.
      logWarn("preventivatore.scheda-tecnica", "embedding scheda approvata fallito", { dettaglio: String(e) });
    }

    const payload = {
      scheda_id: body.scheda_id || null,
      titolo,
      cliente,
      tipo_prodotto: titolo,
      contenuto_md: contenuto,
      embedding,
      n_revisioni: Math.max(0, Number(body.n_revisioni ?? 0)),
      approvata_da: user.id,
    };

    // Se la scheda era già stata approvata, aggiorno (l'utente potrebbe averla
    // ritoccata e riscaricata) invece di accumulare copie quasi identiche.
    let esistente: { id: string } | null = null;
    if (body.scheda_id) {
      const { data } = await admin
        .schema("preventivatore")
        .from("schede_approvate")
        .select("id")
        .eq("scheda_id", body.scheda_id)
        .maybeSingle();
      esistente = (data as { id: string } | null) ?? null;
    }

    const query = esistente
      ? admin.schema("preventivatore").from("schede_approvate").update(payload).eq("id", esistente.id).select("id").single()
      : admin.schema("preventivatore").from("schede_approvate").insert(payload).select("id").single();

    const { data: row, error } = await query;
    if (error) {
      logError("preventivatore.scheda-tecnica", "salvataggio scheda approvata fallito", error);
      return NextResponse.json({ error: "Errore salvataggio esempio approvato" }, { status: 500 });
    }

    // Marca la scheda originale come approvata (audit).
    if (body.scheda_id) {
      const { error: updErr } = await admin
        .schema("preventivatore")
        .from("schede_generate")
        .update({ approvata_il: new Date().toISOString(), contenuto_md: contenuto })
        .eq("id", body.scheda_id);
      if (updErr) logWarn("preventivatore.scheda-tecnica", "marcatura approvata_il fallita", { dettaglio: updErr.message });
    }

    return NextResponse.json({
      ok: true,
      id: (row as { id: string }).id,
      aggiornata: Boolean(esistente),
      indicizzata: embedding != null,
    });
  } catch (err) {
    logError("preventivatore.scheda-tecnica", "approva scheda error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore approvazione scheda" },
      { status: 500 }
    );
  }
}
