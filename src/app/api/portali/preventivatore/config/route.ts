import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

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
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("ai_config")
      .select("id, chiave, valore")
      .order("chiave");

    if (error) {
      console.error("Config fetch error:", error);
      return NextResponse.json({ error: "Errore recupero configurazione" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Config GET error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json() as Record<string, string>;
    const adminClient = createAdminClient();

    const upsertRows = Object.entries(body).map(([chiave, valore]) => ({
      chiave,
      valore: String(valore),
    }));

    if (upsertRows.length === 0) {
      return NextResponse.json({ success: true });
    }

    const { error } = await adminClient
      .schema("preventivatore")
      .from("ai_config")
      .upsert(upsertRows, { onConflict: "chiave" });

    if (error) {
      console.error("Config upsert error:", error);
      return NextResponse.json({ error: "Errore salvataggio configurazione" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Config PATCH error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
