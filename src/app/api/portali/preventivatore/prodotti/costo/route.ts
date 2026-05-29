import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/prodotti/costo?codice=ABC
 * Lookup ESATTO del costo corrente di un codice dall'anagrafica prodotti.
 * Usato dall'editor template per mostrare il costo "live" mentre si digita il codice.
 * Risposta: { trovato, codice, ult_costo, data_ult_costo } | { trovato:false }
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const codice = (request.nextUrl.searchParams.get("codice") ?? "").trim();
    if (!codice) return NextResponse.json({ trovato: false });

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("prodotti")
      .select("codice, ult_costo, data_ult_costo, attivo")
      .eq("codice", codice)
      .maybeSingle();
    if (error) {
      console.error("Prodotti costo lookup error:", error);
      return NextResponse.json({ error: "Errore lookup" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ trovato: false, codice });
    return NextResponse.json({
      trovato: true,
      codice: data.codice,
      ult_costo: data.ult_costo,
      data_ult_costo: data.data_ult_costo,
      attivo: data.attivo,
    });
  } catch (error) {
    console.error("Prodotti costo route error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
