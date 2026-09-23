"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { elencoModelli } from "@/lib/ai/openrouter";

async function superadmin(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();

  if (profile?.ruolo !== "superadmin") redirect("/");
  return user.id;
}

const Modifica = z.object({
  chiave: z.string().trim().min(1),
  modelloPrimario: z.string().trim().min(1, "Il modello principale è obbligatorio.").max(200),
  modelloRiserva: z.string().trim().max(200).nullable(),
  attivo: z.boolean(),
  dpi: z.number().int().min(72, "Sotto i 72 dpi le cifre piccole non si leggono.").max(600),
  massimoPagine: z.number().int().min(1).max(50),
  timeoutSecondi: z.number().int().min(10).max(600),
  massimoTokenRisposta: z.number().int().min(500).max(64000),
});

export type ModificaConfigAi = z.infer<typeof Modifica>;

/**
 * Salva la scelta dei modelli.
 *
 * L'identificativo si verifica contro l'elenco vero di OpenRouter prima di
 * scriverlo: un modello scritto storto non darebbe errore qui, lo darebbe la
 * prima volta che qualcuno carica una fattura, e a quel punto nessuno lo
 * collegherebbe a una modifica fatta giorni prima in un'altra pagina. Se
 * l'elenco non è raggiungibile si salva lo stesso — non è il momento di
 * bloccare una configurazione per un servizio esterno che non risponde — ma lo
 * si dice.
 */
export async function salvaConfigAi(
  dati: ModificaConfigAi
): Promise<{ error?: string; avviso?: string }> {
  const utenteId = await superadmin();

  const parsed = Modifica.safeParse(dati);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(" ") };
  }
  const d = parsed.data;

  let avviso: string | undefined;
  try {
    const modelli = await elencoModelli();
    const perId = new Map(modelli.map((m) => [m.id, m]));
    for (const [etichetta, id] of [
      ["principale", d.modelloPrimario],
      ["di riserva", d.modelloRiserva],
    ] as const) {
      if (!id) continue;
      const trovato = perId.get(id);
      if (!trovato) {
        return { error: `Il modello ${etichetta} «${id}» non esiste su OpenRouter.` };
      }
      if (!trovato.vedeImmagini) {
        return {
          error:
            `Il modello ${etichetta} «${id}» non accetta immagini, e le fatture da leggere ` +
            "sono immagini: sceglierne uno multimodale.",
        };
      }
    }
  } catch {
    avviso =
      "L'elenco dei modelli di OpenRouter non è raggiungibile: la configurazione è stata " +
      "salvata senza poter verificare che i modelli esistano.";
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_config")
    .update({
      modello_primario: d.modelloPrimario,
      modello_riserva: d.modelloRiserva || null,
      attivo: d.attivo,
      parametri: {
        dpi: d.dpi,
        massimo_pagine: d.massimoPagine,
        timeout_secondi: d.timeoutSecondi,
        massimo_token_risposta: d.massimoTokenRisposta,
      },
      aggiornato_il: new Date().toISOString(),
      aggiornato_da: utenteId,
    })
    .eq("chiave", d.chiave);

  if (error) return { error: error.message };

  revalidatePath("/superadmin/ai");
  return { avviso };
}
