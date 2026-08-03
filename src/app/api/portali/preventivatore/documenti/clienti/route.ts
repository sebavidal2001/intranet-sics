import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { getFiltroCommerciale, getIdClientiVisibili } from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
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

    const adminClient = createAdminClient();

    // Il dropdown elenca la ragione sociale del master, non il TEXT libero
    // `documenti.cliente`: quest'ultimo contiene le varianti storiche e faceva
    // comparire lo stesso cliente più volte (ALPHAMAC / ALPHAMAC srl, SER.MAC /
    // SER.MAC., le 9 varianti IMA…). Fallback sul testo per i documenti non
    // ancora agganciati all'anagrafica.
    let query = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("cliente, clienti_master(ragione_sociale)")
      .order("cliente", { ascending: true })
      // Limite esplicito: senza, PostgREST tronca a 1.000 righe in silenzio e
      // il dropdown perderebbe clienti man mano che l'archivio cresce.
      .limit(20000);

    // Scope commerciale: l'elenco clienti è un dato di business. Un commerciale
    // ristretto non deve poter enumerare le ragioni sociali fuori portfolio.
    const agenteCommerciale = await getFiltroCommerciale(user.id, livello);
    if (agenteCommerciale) {
      const idsVisibili = await getIdClientiVisibili(agenteCommerciale);
      if (idsVisibili.length === 0) return NextResponse.json([]);
      query = query.in("cliente_master_id", idsVisibili);
    }

    const { data, error } = await query;

    if (error) {
      logError("preventivatore.documenti.clienti", "Clienti unici fetch error", error);
      return NextResponse.json({ error: "Errore recupero clienti" }, { status: 500 });
    }

    // Deduplicate in JS since Supabase JS client doesn't expose DISTINCT directly
    const unici = [
      ...new Set(
        (data ?? [])
          .map((r) => {
            // L'embed è many-to-one, ma i tipi generati lo dichiarano array.
            const row = r as unknown as {
              cliente: string | null;
              clienti_master: { ragione_sociale: string | null } | { ragione_sociale: string | null }[] | null;
            };
            const master = Array.isArray(row.clienti_master) ? row.clienti_master[0] : row.clienti_master;
            return master?.ragione_sociale ?? row.cliente;
          })
          .filter((c): c is string => c !== null && c.trim() !== "")
      ),
    ].sort();

    return NextResponse.json(unici);
  } catch (error) {
    logError("preventivatore.documenti.clienti", "Clienti documenti route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
