import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { getFiltroCommerciale, AGENTE_AIRFLUID } from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/clienti/destinazioni?codice_cliente=XXXXXXXX
 *
 * Restituisce TUTTE le destinazioni/sedi di un cliente (raggruppate per
 * `codice_cliente`). Usato come 2° step del picker cliente a cascata:
 * 1. l'utente cerca e sceglie la ragione sociale
 * 2. la UI chiama questo endpoint e mostra le destinazioni per scegliere
 *    quella corretta (es. IMA spa → 47 destinazioni: SAFE, LIFE, BFB, ecc.)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const codice = request.nextUrl.searchParams.get("codice_cliente")?.trim();
    if (!codice) {
      return NextResponse.json({ error: "codice_cliente mancante" }, { status: 400 });
    }

    const admin = createAdminClient();
    let q = admin
      .schema("preventivatore")
      .from("clienti_master")
      .select(
        "id, ragione_sociale, destinazione, id_destinazione, cap, localita, cat_zona, agente_nome, agente_codice, cat_commerciale"
      )
      .eq("codice_cliente", codice)
      .eq("attivo", true)
      .order("destinazione", { ascending: true, nullsFirst: true })
      .limit(200);

    // Filtro commerciale: blocca accesso a destinazioni di clienti non in portfolio
    const agenteCommerciale = await getFiltroCommerciale(user.id, livello);
    if (agenteCommerciale) {
      q = q.in("agente_codice", [agenteCommerciale, AGENTE_AIRFLUID]);
    }
    const { data, error } = await q;

    if (error) {
      logError("preventivatore.clienti.destinazioni", "destinazioni fetch error", error);
      return NextResponse.json({ error: "Errore recupero destinazioni" }, { status: 500 });
    }

    const items = (data ?? []).map((r) => {
      const zona = (r.cat_zona as string | null) ?? "";
      const provMatch = zona.match(/^([A-Z]{2})-/);
      return {
        id: r.id as string,
        ragione_sociale: r.ragione_sociale as string,
        destinazione: r.destinazione as string | null,
        id_destinazione: r.id_destinazione as string | null,
        piva: null as string | null,
        citta: r.localita as string | null,
        provincia: provMatch ? provMatch[1] : null,
        cap: r.cap as string | null,
        agente_nome: r.agente_nome as string | null,
        agente_codice: r.agente_codice as string | null,
        cat_commerciale: r.cat_commerciale as string | null,
        is_hq: (r.ragione_sociale as string)?.trim() === (r.destinazione as string)?.trim(),
      };
    });

    return NextResponse.json(items);
  } catch (error) {
    logError("preventivatore.clienti.destinazioni", "Destinazioni route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
