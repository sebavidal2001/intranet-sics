import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

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
      .from("clienti")
      .select("id, ragione_sociale, piva, citta, provincia")
      .eq("is_attivo", true)
      .limit(10);

    if (q) {
      query = query.ilike("ragione_sociale", `%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Clienti fetch error:", error);
      return NextResponse.json({ error: "Errore recupero clienti" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Clienti route error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
