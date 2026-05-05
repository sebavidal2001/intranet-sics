import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

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
      .from("prodotti")
      .select("id, codice, descrizione, categoria, unita_misura, prezzo_listino, fornitore, giacenza")
      .eq("is_attivo", true)
      .limit(20);

    if (q) {
      query = query.or(`codice.ilike.%${q}%,descrizione.ilike.%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Prodotti fetch error:", error);
      return NextResponse.json({ error: "Errore recupero prodotti" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Prodotti route error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
