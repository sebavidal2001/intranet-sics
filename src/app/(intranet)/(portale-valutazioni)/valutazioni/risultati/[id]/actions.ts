"use server";

import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Clona le risposte del responsabile dall'ultima sessione annuale
 * dello stesso utente come punto di partenza per la sessione corrente.
 * Crea risposte_valutazione pre-compilate (responsabile) che il responsabile
 * potrà modificare.
 */
export async function cloneSchedaAnnoPrecedente(
  sessioneId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) return { error: "Non autorizzato" };

  // Carica sessione corrente
  const { data: sessione } = await supabase
    .from("sessioni_utente")
    .select("id, utente_id, anno, responsabile_id")
    .eq("id", sessioneId)
    .single();

  if (!sessione) return { error: "Sessione non trovata" };

  // Trova l'ultima sessione annuale precedente
  const { data: sessionePrec } = await supabase
    .from("sessioni_utente")
    .select("id")
    .eq("utente_id", sessione.utente_id)
    .eq("tipo_valutazione", "annuale")
    .lt("anno", sessione.anno)
    .order("anno", { ascending: false })
    .limit(1)
    .single();

  if (!sessionePrec) return { error: "Nessuna sessione annuale precedente" };

  // Carica risposte responsabile dalla sessione precedente
  const { data: rispostePrec } = await supabase
    .from("risposte_valutazione")
    .select("mansione_id, punteggio, note")
    .eq("sessione_utente_id", sessionePrec.id)
    .eq("tipo", "responsabile");

  if (!rispostePrec || rispostePrec.length === 0) {
    return { error: "Nessuna risposta responsabile nell'anno precedente" };
  }

  // Valutatore = responsabile della sessione corrente (o l'admin che lancia l'azione)
  const valutatore_id = sessione.responsabile_id ?? user.id;

  // Inserisce le risposte come bozza per la sessione corrente
  // Usa upsert per non duplicare se già esistenti
  const { error: insertErr } = await supabase
    .from("risposte_valutazione")
    .upsert(
      rispostePrec.map((r) => ({
        sessione_utente_id: sessioneId,
        mansione_id: r.mansione_id,
        valutatore_id,
        punteggio: r.punteggio,
        tipo: "responsabile" as const,
        note: r.note,
      })),
      { onConflict: "sessione_utente_id,mansione_id,tipo" }
    );

  if (insertErr) return { error: insertErr.message };

  revalidatePath(`/valutazioni/risultati/${sessioneId}`);
  revalidatePath(`/valutazioni/responsabile/${sessioneId}`);
  return {};
}
