import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireConsuntivazione, UUID_RE } from "@/lib/portali/preventivatore/consuntivi-guard";
import { requireDocumentoVisibile } from "@/lib/portali/preventivatore/documento-visibile";
import { escapeIlike } from "@/lib/portali/preventivatore/postgrest";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/consuntivi/sorgente
 *   ?q=testo            → cerca preventivi (codice, cliente, titolo) per scegliere la sorgente
 *   ?documento_id=uuid  → blocchi e righe del preventivo, per scegliere cosa consuntivare
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const sp = new URL(request.url).searchParams;
    const sb = createAdminClient().schema("preventivatore");
    const documentoId = sp.get("documento_id");

    if (!documentoId) {
      const q = (sp.get("q") ?? "").trim().slice(0, 60);
      if (q.length < 2) return NextResponse.json({ documenti: [] });
      const e = escapeIlike(q);
      const { data, error } = await sb
        .from("documenti")
        .select("id, codice, cliente, tipo, tipo_prodotto, stato, importo_preventivo, created_at")
        .or(`codice.ilike.%${e}%,cliente.ilike.%${e}%,tipo_prodotto.ilike.%${e}%`)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return NextResponse.json({ documenti: data ?? [] });
    }

    if (!UUID_RE.test(documentoId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const visibilita = await requireDocumentoVisibile({ userId: guard.user.id, livello: guard.ctx.livello }, documentoId);
    if (!visibilita.ok) return NextResponse.json({ error: visibilita.error }, { status: visibilita.status });

    const [doc, blocchi, righe] = await Promise.all([
      sb.from("documenti").select("id, codice, cliente, tipo_prodotto, tipo, stato").eq("id", documentoId).maybeSingle(),
      sb
        .from("blocchi")
        .select("codice_blocco, quantita_pezzi, ordine")
        .eq("documento_id", documentoId)
        .order("ordine", { ascending: true, nullsFirst: false }),
      sb
        .from("righe_distinta")
        .select("id, codice_blocco, tipo_riga, codice_articolo, descrizione, quantita, prezzo_unitario, costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, split_fonte")
        .eq("documento_id", documentoId)
        .order("ordine", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
    ]);
    if (doc.error) throw doc.error;
    if (blocchi.error) throw blocchi.error;
    if (righe.error) throw righe.error;
    return NextResponse.json({ documento: doc.data, blocchi: blocchi.data ?? [], righe: righe.data ?? [] });
  } catch (e) {
    logError("preventivatore.consuntivi", "sorgente error", e);
    return NextResponse.json({ error: "Errore lettura preventivo" }, { status: 500 });
  }
}
