import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET  /api/portali/preventivatore/sessioni   → lista sessioni utente
// POST /api/portali/preventivatore/sessioni   → crea nuova sessione

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("chat_sessioni")
      .select("id, contesto, titolo, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      logError("preventivatore.sessioni", "GET sessioni error", error);
      return NextResponse.json({ error: "Errore DB" }, { status: 500 });
    }

    return NextResponse.json({ sessioni: data ?? [] });
  } catch (err) {
    logError("preventivatore.sessioni", "GET sessioni unexpected", err);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = await request.json() as { contesto?: string; titolo?: string };
    const contesto = body.contesto === "nuovo" ? "nuovo" : "archivio";
    const titolo = (typeof body.titolo === "string" ? body.titolo : "").slice(0, 120) || "Nuova chat";

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("chat_sessioni")
      .insert({ user_id: user.id, contesto, titolo })
      .select("id, contesto, titolo, created_at, updated_at")
      .single();

    if (error) {
      logError("preventivatore.sessioni", "POST sessioni error", error);
      return NextResponse.json({ error: "Errore creazione sessione" }, { status: 500 });
    }

    return NextResponse.json({ sessione: data });
  } catch (err) {
    logError("preventivatore.sessioni", "POST sessioni unexpected", err);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
