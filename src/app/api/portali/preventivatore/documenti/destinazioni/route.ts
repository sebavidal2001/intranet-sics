import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { idsMasterPerRagioneSociale } from "@/lib/portali/preventivatore/clienti-filtro";
import { getFiltroCommerciale, getIdClientiVisibili } from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/documenti/destinazioni?cliente=<ragione sociale>
 *
 * Secondo livello del filtro cliente dell'Archivio: le sedi/divisioni del
 * cliente selezionato **che hanno almeno un preventivo**. Elencare tutte le
 * destinazioni anagrafiche sarebbe inutile (IMA ne ha 47, ma solo 6 compaiono
 * nello storico).
 *
 * Risposta: `[{ id, destinazione, n }]` ordinata per numero di preventivi.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const cliente = request.nextUrl.searchParams.get("cliente")?.trim();
    if (!cliente) return NextResponse.json([]);

    let ids = await idsMasterPerRagioneSociale(cliente);
    if (ids.length === 0) return NextResponse.json([]);

    // Scope commerciale: un commerciale ristretto non deve poter enumerare le
    // sedi dei clienti fuori dal suo portfolio passando una ragione sociale a mano.
    const agente = await getFiltroCommerciale(user.id, livello);
    if (agente) {
      const visibili = new Set(await getIdClientiVisibili(agente));
      ids = ids.filter((id) => visibili.has(id));
      if (ids.length === 0) return NextResponse.json([]);
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("documenti")
      .select("cliente_master_id, clienti_master(destinazione)")
      .in("cliente_master_id", ids);

    if (error) {
      logError("preventivatore.documenti.destinazioni", "destinazioni fetch error", error);
      return NextResponse.json({ error: "Errore recupero destinazioni" }, { status: 500 });
    }

    // Conteggio per destinazione. Righe master diverse con la stessa etichetta
    // non esistono più dopo la dedup (migration 080), ma il raggruppamento per
    // id resta la chiave corretta perché è quella che il filtro invia.
    const perId = new Map<string, { id: string; destinazione: string | null; n: number }>();
    for (const r of data ?? []) {
      const row = r as unknown as {
        cliente_master_id: string | null;
        clienti_master: { destinazione: string | null } | { destinazione: string | null }[] | null;
      };
      if (!row.cliente_master_id) continue;
      const master = Array.isArray(row.clienti_master) ? row.clienti_master[0] : row.clienti_master;
      const prev = perId.get(row.cliente_master_id);
      if (prev) prev.n += 1;
      else perId.set(row.cliente_master_id, { id: row.cliente_master_id, destinazione: master?.destinazione ?? null, n: 1 });
    }

    const items = [...perId.values()].sort((a, b) => b.n - a.n || (a.destinazione ?? "").localeCompare(b.destinazione ?? ""));
    return NextResponse.json(items);
  } catch (error) {
    logError("preventivatore.documenti.destinazioni", "destinazioni route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
