import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/prodotti/costo?codice=ABC
 * Lookup ESATTO del costo corrente di un codice.
 * Legge da `v_prodotti_costo` (migration 084): il costo è quello effettivo —
 * listino fornitore se il codice c'è, altrimenti ultimo costo del Cruscotto.
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

    const admin = createAdminClient();

    // Modalità batch: ?codici=a,b,c → { items: [{ codice, ult_costo, data_ult_costo, attivo }] }.
    // Usata dal builder in modifica per il pulsante "Aggiorna prezzi".
    const codiciRaw = (request.nextUrl.searchParams.get("codici") ?? "").trim();
    if (codiciRaw) {
      const codici = Array.from(
        new Set(codiciRaw.split(",").map((c) => c.trim()).filter(Boolean))
      ).slice(0, 500);
      if (codici.length === 0) return NextResponse.json({ items: [] });
      const { data, error } = await admin
        .schema("preventivatore")
        .from("v_prodotti_costo")
        .select("codice, ult_costo, data_ult_costo, attivo, fonte_costo, fornitore_listino")
        .in("codice", codici);
      if (error) {
        logError("preventivatore.prodotti.costo", "Prodotti costo batch error", error);
        return NextResponse.json({ error: "Errore lookup" }, { status: 500 });
      }
      return NextResponse.json({ items: data ?? [] });
    }

    const codice = (request.nextUrl.searchParams.get("codice") ?? "").trim();
    if (!codice) return NextResponse.json({ trovato: false });
    const { data, error } = await admin
      .schema("preventivatore")
      .from("v_prodotti_costo")
      .select("codice, ult_costo, data_ult_costo, attivo, fonte_costo, fornitore_listino")
      .eq("codice", codice)
      .maybeSingle();
    if (error) {
      logError("preventivatore.prodotti.costo", "Prodotti costo lookup error", error);
      return NextResponse.json({ error: "Errore lookup" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ trovato: false, codice });
    return NextResponse.json({
      trovato: true,
      codice: data.codice,
      ult_costo: data.ult_costo,
      data_ult_costo: data.data_ult_costo,
      attivo: data.attivo,
      fonte_costo: data.fonte_costo,
      fornitore_listino: data.fornitore_listino,
    });
  } catch (error) {
    logError("preventivatore.prodotti.costo", "Prodotti costo route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
