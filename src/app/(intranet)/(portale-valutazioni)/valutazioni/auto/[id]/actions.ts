"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type RispostaMansioneInput = {
  mansione_id: string;
  punteggio: number;
  note?: string;
};

type RispostaSkillInput = {
  skill_id: string;
  punteggio: number;
  note?: string;
};

type SalvaRisposteAutoData = {
  sessione_id: string;
  risposteMansioni: RispostaMansioneInput[];
  risposteSkills: RispostaSkillInput[];
  completa: boolean;
};

type ActionResult = { error?: string };

export async function salvaRisposteAuto(
  data: SalvaRisposteAutoData
): Promise<ActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: sessione, error: errSessione } = await supabase
    .from("sessioni_utente")
    .select("id, utente_id, stato")
    .eq("id", data.sessione_id)
    .single();

  if (errSessione || !sessione) return { error: "Sessione non trovata" };
  if (sessione.utente_id !== user.id) return { error: "Non autorizzato" };

  if (
    sessione.stato !== "resp_completata" &&
    sessione.stato !== "collab_in_corso"
  ) {
    return { error: "La sessione non è aperta per l'autovalutazione" };
  }

  // Usa admin client per bypassare RLS su delete + insert risposte
  const adminClient = createAdminClient();

  // Salva risposte mansioni (delete + insert)
  if (data.risposteMansioni.length > 0) {
    await adminClient
      .from("risposte_valutazione")
      .delete()
      .eq("sessione_utente_id", data.sessione_id)
      .eq("tipo", "autovalutazione")
      .not("mansione_id", "is", null);

    const mansioniRows = data.risposteMansioni.map((r) => ({
      sessione_utente_id: data.sessione_id,
      mansione_id: r.mansione_id,
      skill_id: null,
      valutatore_id: user.id,
      punteggio: r.punteggio,
      tipo: "autovalutazione" as const,
      note: r.note ?? null,
    }));

    const { error: errM } = await adminClient
      .from("risposte_valutazione")
      .insert(mansioniRows);

    if (errM) return { error: errM.message };
  }

  // Salva risposte skills (delete + insert)
  if (data.risposteSkills.length > 0) {
    await adminClient
      .from("risposte_valutazione")
      .delete()
      .eq("sessione_utente_id", data.sessione_id)
      .eq("tipo", "autovalutazione")
      .not("skill_id", "is", null);

    const skillRows = data.risposteSkills.map((r) => ({
      sessione_utente_id: data.sessione_id,
      mansione_id: null,
      skill_id: r.skill_id,
      valutatore_id: user.id,
      punteggio: r.punteggio,
      tipo: "autovalutazione" as const,
      note: r.note ?? null,
    }));

    const { error: errS } = await adminClient
      .from("risposte_valutazione")
      .insert(skillRows);

    if (errS) return { error: errS.message };
  }

  if (data.completa) {
    // Usa admin client per bypassare RLS sull'update dello stato
    const adminClient = createAdminClient();
    const { error: errUpdate } = await adminClient
      .from("sessioni_utente")
      .update({ stato: "completata" })
      .eq("id", data.sessione_id);

    if (errUpdate) return { error: errUpdate.message };
  }

  revalidatePath(`/valutazioni/auto/${data.sessione_id}`);
  revalidatePath("/valutazioni");

  return {};
}
