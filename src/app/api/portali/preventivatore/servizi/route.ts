import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

function parseNonNegativeNumber(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * GET  — elenco servizi/lavorazioni (default solo attivi; `?all=1` include i disattivati)
 * POST — crea un nuovo servizio (solo admin del portale)
 *
 * Tabella: preventivatore.servizi_manodopera
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const includiInattivi = request.nextUrl.searchParams.get("all") === "1";

    const adminClient = createAdminClient();
    let query = adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo")
      .order("ordine", { ascending: true });

    if (!includiInattivi) query = query.eq("is_attivo", true);

    const { data, error } = await query;
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json();
    const nome = String(body?.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome obbligatorio" }, { status: 400 });

    const tariffaOra = parseNonNegativeNumber(body?.tariffa_ora, 0);
    const ordine = parseNonNegativeNumber(body?.ordine, 999);
    if (tariffaOra === null) {
      return NextResponse.json({ error: "Tariffa non valida" }, { status: 400 });
    }
    if (ordine === null) {
      return NextResponse.json({ error: "Ordine non valido" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .insert({
        nome,
        categoria: String(body?.categoria ?? "").trim() || "Manodopera",
        tariffa_ora: tariffaOra,
        unita: String(body?.unita ?? "h").trim() || "h",
        ordine,
        is_attivo: body?.is_attivo !== false,
      })
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo")
      .single();

    if (error) {
      console.error("Servizio create error:", error);
      return NextResponse.json({ error: "Errore creazione servizio" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Servizi POST error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
