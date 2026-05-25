import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/clienti?q=...
 *
 * Autocomplete clienti dal master anagrafica (`preventivatore.clienti_master`,
 * popolato dal Cruscotto Dinamico via cron VM — vedi scripts/import-clienti-cruscotto.cjs).
 *
 * Struttura a 2 livelli (ragione sociale + sede/divisione): un cliente "IMA spa"
 * può avere 47 destinazioni nel master (IMA spa-div.SAFE, ecc.).
 *
 * Risposta: array di max 30 record con { id, ragione_sociale, destinazione,
 * citta, provincia, agente_nome, agente_codice }.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const adminClient = createAdminClient();

    let query = adminClient
      .schema("preventivatore")
      .from("clienti_master")
      .select(
        "id, codice_cliente, ragione_sociale, destinazione, id_destinazione, cap, localita, cat_zona, agente_nome, agente_codice, cat_commerciale"
      )
      .eq("attivo", true)
      .order("ragione_sociale", { ascending: true })
      .limit(60);

    if (q) {
      // Match su ragione OR destinazione
      const esc = q.replace(/[%_,]/g, (c) => `\\${c}`);
      query = query.or(`ragione_sociale.ilike.%${esc}%,destinazione.ilike.%${esc}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("clienti_master fetch error:", error);
      return NextResponse.json({ error: "Errore recupero clienti" }, { status: 500 });
    }

    // Normalizza il payload per il frontend (provincia ricavabile da cat_zona "XX-YYYY")
    const items = (data ?? []).map((r) => {
      const zona = (r.cat_zona as string | null) ?? "";
      const provMatch = zona.match(/^([A-Z]{2})-/);
      return {
        id: r.id as string,
        codice_cliente: r.codice_cliente as string,
        ragione_sociale: r.ragione_sociale as string,
        destinazione: r.destinazione as string | null,
        id_destinazione: r.id_destinazione as string | null,
        piva: null as string | null, // non disponibile nel Cruscotto
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
    console.error("Clienti route error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
