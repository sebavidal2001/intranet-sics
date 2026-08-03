import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Risoluzione del filtro "cliente" delle viste preventivi.
 *
 * Il TEXT libero `documenti.cliente` contiene le varianti di digitazione degli
 * storici: "ALPHAMAC" e "ALPHAMAC srl" sono lo stesso 05006264, "IMA SAFE" /
 * "IMA-BFB" / "GIMA" sono tutte IMA spa. Filtrare per testo esatto spezza il
 * cliente in più voci; per questo le viste mostrano ed accettano la **ragione
 * sociale del master** e la risolvono qui negli id anagrafica corrispondenti
 * (un cliente ha N destinazioni: IMA ne usa 6, WALVOIL 4).
 */
export async function idsMasterPerRagioneSociale(ragioneSociale: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .schema("preventivatore")
    .from("clienti_master")
    .select("id")
    .eq("ragione_sociale", ragioneSociale);
  return (data ?? []).map((r) => r.id as string);
}

// Nota: il filtro va applicato al call site e non da un helper `async` che
// restituisce la query — il builder Supabase è thenable, quindi `await` su una
// Promise<Builder> eseguirebbe la query invece di restituirla. Pattern:
//
//   const ids = await idsMasterPerRagioneSociale(cliente);
//   query = ids.length > 0 ? query.in("cliente_master_id", ids) : query.eq("cliente", cliente);
//
// Il ramo `eq` copre i documenti non ancora agganciati al master: oggi zero, ma
// un import futuro può crearne.
