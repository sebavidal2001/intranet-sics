import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

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
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("motivi_rifiuto")
      .select("id, label, ordine")
      .eq("is_attivo", true)
      .order("ordine");

    if (error) {
      console.error("Motivi rifiuto error:", error);
      return NextResponse.json(
        { error: "Errore recupero motivi rifiuto" },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Motivi rifiuto GET error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
