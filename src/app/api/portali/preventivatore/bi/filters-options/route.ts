import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Restituisce le opzioni distinte da popolare nei dropdown dei filtri globali BI.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const admin = createAdminClient().schema("preventivatore");
    const [anniRes, clientiRes, categorieRes] = await Promise.all([
      admin.from("documenti").select("anno").not("anno", "is", null).order("anno", { ascending: false }),
      // Il BI raggruppa per ragione sociale del master (vedi query-engine): il
      // dropdown deve offrire le stesse voci, non le varianti di testo storiche.
      admin
        .from("documenti")
        .select("cliente, clienti_master(ragione_sociale)")
        .order("cliente", { ascending: true }),
      admin.from("documenti").select("categoria").not("categoria", "is", null).order("categoria", { ascending: true }),
    ]);

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
