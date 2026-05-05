import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
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

    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .select("id, nome, categoria, tariffa_ora, unita")
      .eq("is_attivo", true)
      .order("ordine", { ascending: true });

    if (error) {
      console.error("Servizi fetch error:", error);
      return NextResponse.json({ error: "Errore recupero servizi" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Servizi route error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
