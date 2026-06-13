import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET  — elenco template (default solo attivi; `?all=1` include i disattivi)
 * POST — crea un nuovo template vuoto (solo admin)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const includiInattivi = request.nextUrl.searchParams.get("all") === "1";
    const admin = createAdminClient();
    let query = admin
      .schema("preventivatore")
      .from("template")
      .select("id, nome, slug, descrizione, attivo, ordine, consegna_settimane_min, consegna_settimane_max")
      .order("ordine", { ascending: true });
    if (!includiInattivi) query = query.eq("attivo", true);

    const { data, error } = await query;
    if (error) {
      logError("preventivatore.template", "Template list error", error);
      return NextResponse.json({ error: "Errore recupero template" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (error) {
    logError("preventivatore.template", "Template GET error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const nome = String(body?.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome obbligatorio" }, { status: 400 });
    const slug = String(body?.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!slug) return NextResponse.json({ error: "Slug non valido" }, { status: 400 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("template")
      .insert({ nome, slug, descrizione: body?.descrizione ?? null })
      .select("id, slug")
      .single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Slug già esistente" }, { status: 409 });
      logError("preventivatore.template", "Template create error", error);
      return NextResponse.json({ error: "Errore creazione template" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    logError("preventivatore.template", "Template POST error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
