import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/portali/valutazioni/sessioni/sblocca
 *
 * Apre o chiude una sessione di valutazione globale (`sessioni_valutazione`).
 * NON invia alcuna email: l'invio di notifiche è stato disabilitato su
 * richiesta esplicita (la sessione si comunica internamente in altri modi).
 *
 * Body: { sessioneId: string, isAperta: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const isAdmin = await isValutazioniAdmin(supabase, user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json();
    const { sessioneId, isAperta } = body;

    if (!sessioneId || typeof isAperta !== "boolean") {
      return NextResponse.json({ error: "Parametri non validi" }, { status: 400 });
    }

    // Verifica esistenza sessione (diagnostica chiara: distingue "non trovata"
    // da "errore di scrittura/permesso")
    const { data: esistente, error: readError } = await supabase
      .from("sessioni_valutazione")
      .select("id")
      .eq("id", sessioneId)
      .maybeSingle();

    if (readError) {
      logError("valutazioni.sessioni.sblocca", "Sblocca sessione - lettura", readError);
      return NextResponse.json(
        { error: "Errore lettura sessione" },
        { status: 500 }
      );
    }
    if (!esistente) {
      return NextResponse.json(
        { error: "Sessione non trovata" },
        { status: 404 }
      );
    }

    // Aggiorna lo stato della sessione
    const { error: updateError } = await supabase
      .from("sessioni_valutazione")
      .update({ is_aperta: isAperta })
      .eq("id", sessioneId);

    if (updateError) {
      logError("valutazioni.sessioni.sblocca", "Sblocca sessione - update", updateError);
      return NextResponse.json(
        { error: "Errore aggiornamento sessione" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Sessione ${isAperta ? "aperta" : "chiusa"}.`,
    });
  } catch (error) {
    logError("valutazioni.sessioni.sblocca", "Sblocca sessione error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
