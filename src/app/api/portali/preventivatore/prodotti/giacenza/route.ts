import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/prodotti/giacenza?codici=A,B,C
 * Ritorna giacenza (esistenza/disponibilità) + descrizione per i codici richiesti.
 * Usato dalla modale riepilogo materiali (alert "da ordinare").
 * Risposta: { items: [{ codice, descrizione, esistenza, disponibilita }] }
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const raw = (request.nextUrl.searchParams.get("codici") ?? "").trim();
    if (!raw) return NextResponse.json({ items: [] });
    const codici = Array.from(new Set(raw.split(",").map((c) => c.trim()).filter(Boolean))).slice(0, 100);
    if (codici.length === 0) return NextResponse.json({ items: [] });

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("v_prodotti_completo")
      .select("codice, descrizione, esistenza_totale, disponibilita_totale")
      .in("codice", codici);
    if (error) {
      console.error("Giacenza lookup error:", error);
      return NextResponse.json({ error: "Errore lookup giacenza" }, { status: 500 });
    }
    const items = ((data ?? []) as Array<{ codice: string; descrizione: string | null; esistenza_totale: number | null; disponibilita_totale: number | null }>).map((r) => ({
      codice: r.codice,
      descrizione: r.descrizione ?? "",
      esistenza: r.esistenza_totale,
      disponibilita: r.disponibilita_totale,
    }));
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Giacenza route error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
