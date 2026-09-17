import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore, scopeAgente } from "@/lib/portali/preventivatore/api-guard";
import { getIdClientiVisibili } from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Tetto di righe lette per costruire le liste di valori distinti. Senza, ogni
 * apertura della pagina BI faceva tre `select` sull'INTERA tabella `documenti`
 * solo per ricavare tre elenchi di poche decine di voci.
 */
const MAX_RIGHE = 20_000;

/**
 * GET /api/portali/preventivatore/bi/filters-options
 *
 * Opzioni dei dropdown dei filtri globali della BI del Preventivatore
 * (anni, clienti, categorie), ricavate da `preventivatore.documenti`.
 *
 * Scope commerciale: le voci rispecchiano solo i documenti che l'utente può
 * vedere, esattamente come `bi/data`. Prima questa route si limitava a
 * verificare l'accesso al portale e poi leggeva con l'admin client senza
 * filtro: un commerciale ristretto si ritrovava nel menu «Cliente» l'intera
 * anagrafica, cioè proprio l'enumerazione che `documenti/clienti` e
 * `documenti/destinazioni` si preoccupano di impedire.
 */
export async function GET() {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;

    const agente = scopeAgente(guard.ctx);
    const clienteIds = agente ? await getIdClientiVisibili(agente) : null;

    // Commerciale ristretto senza clienti visibili: nessuna opzione, non tutte.
    if (clienteIds !== null && clienteIds.length === 0) {
      return NextResponse.json({ anni: [], clienti: [], categorie: [] });
    }

    const admin = createAdminClient().schema("preventivatore");

    let qAnni = admin.from("documenti").select("anno").not("anno", "is", null).limit(MAX_RIGHE);
    // Il BI raggruppa per ragione sociale del master (vedi query-engine): il
    // dropdown deve offrire le stesse voci, non le varianti di testo storiche.
    let qClienti = admin
      .from("documenti")
      .select("cliente, clienti_master(ragione_sociale)")
      .limit(MAX_RIGHE);
    let qCategorie = admin
      .from("documenti")
      .select("categoria")
      .not("categoria", "is", null)
      .limit(MAX_RIGHE);

    if (clienteIds) {
      qAnni = qAnni.in("cliente_master_id", clienteIds);
      qClienti = qClienti.in("cliente_master_id", clienteIds);
      qCategorie = qCategorie.in("cliente_master_id", clienteIds);
    }

    const [anniRes, clientiRes, categorieRes] = await Promise.all([qAnni, qClienti, qCategorie]);

    const anni = Array.from(new Set((anniRes.data ?? []).map((r) => (r as { anno: number }).anno))).sort((a, b) => b - a);
    const clienti = Array.from(
      new Set(
        (clientiRes.data ?? [])
          .map((r) => {
            // L'embed è many-to-one, ma i tipi generati lo dichiarano array:
            // normalizziamo entrambe le forme.
            const row = r as unknown as {
              cliente: string | null;
              clienti_master: { ragione_sociale: string | null } | { ragione_sociale: string | null }[] | null;
            };
            const master = Array.isArray(row.clienti_master) ? row.clienti_master[0] : row.clienti_master;
            return master?.ragione_sociale ?? row.cliente;
          })
          .filter((v): v is string => Boolean(v))
      )
    ).sort();
    const categorie = Array.from(new Set((categorieRes.data ?? []).map((r) => (r as { categoria: string }).categoria))).sort();

    return NextResponse.json({ anni, clienti, categorie });
  } catch (error) {
    logError("preventivatore.bi.filters-options", "filters-options error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
