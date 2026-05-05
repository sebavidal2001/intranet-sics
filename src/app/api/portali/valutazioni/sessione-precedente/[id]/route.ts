import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessione-precedente/[id]
 *
 * Dato l'id di una sessione_utente, trova l'ultima sessione annuale
 * dello stesso utente dell'anno precedente e restituisce i dati
 * (mansioni, risposte, note) pronti per essere clonati.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const sessioneId = params.id;

  // Carica sessione corrente
  const { data: sessione } = await supabase
    .from("sessioni_utente")
    .select("id, utente_id, anno, scala_id, tipo_valutazione")
    .eq("id", sessioneId)
    .single() as unknown as { data: { id: string; utente_id: string; anno: number; scala_id: string | null; tipo_valutazione: string | null } | null };

  if (!sessione) return NextResponse.json({ error: "Sessione non trovata" }, { status: 404 });

  // Trova l'ultima sessione annuale dell'anno precedente per lo stesso utente
  const { data: sessionePrec } = await supabase
    .from("sessioni_utente")
    .select(`
      id, anno, stato,
      scala:scale_valutazione(id, nome, min, max)
    `)
    .eq("utente_id", sessione.utente_id)
    .eq("tipo_valutazione", "annuale")
    .lt("anno", sessione.anno)
    .order("anno", { ascending: false })
    .limit(1)
    .single();

  if (!sessionePrec) {
    return NextResponse.json({ error: "Nessuna sessione annuale precedente trovata" }, { status: 404 });
  }

  // Carica le risposte del responsabile dalla sessione precedente
  const { data: risposte } = await supabase
    .from("risposte_valutazione")
    .select(`
      mansione_id,
      punteggio,
      tipo,
      note,
      mansione:mansioni(id, testo, ordine, parametro_radar:parametri_radar(id, nome, colore))
    `)
    .eq("sessione_utente_id", sessionePrec.id)
    .eq("tipo", "responsabile");

  return NextResponse.json({
    sessionePrecedente: {
      id: sessionePrec.id,
      anno: sessionePrec.anno,
      scala: sessionePrec.scala,
    },
    risposte: risposte ?? [],
  });
}
