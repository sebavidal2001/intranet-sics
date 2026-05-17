"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireValutazioniAdmin } from "@/lib/auth/require-admin";
import { revalidatePath } from "next/cache";

export async function updateSkillGlobal(
  id: string,
  data: { nome: string; descrizione?: string; ordine: number; parametro_radar_id: string | null }
): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();

  const { error } = await sb
    .from("skills")
    .update({
      nome: data.nome,
      descrizione: data.descrizione ?? null,
      ordine: data.ordine,
      parametro_radar_id: data.parametro_radar_id,
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/config/skills");
  return {};
}

export async function deleteSkillGlobal(id: string): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();

  const { error } = await sb.from("skills").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/config/skills");
  return {};
}

export async function createSkillGlobal(data: {
  nome: string;
  descrizione?: string;
  ordine: number;
  parametro_radar_id: string | null;
}): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();

  const { error } = await sb.from("skills").insert({
    nome: data.nome,
    descrizione: data.descrizione ?? null,
    ordine: data.ordine,
    parametro_radar_id: data.parametro_radar_id,
  });

  if (error) return { error: error.message };
  revalidatePath("/admin/config/skills");
  return {};
}

/**
 * Unisce duplicati: dato un gruppo di id di skills (stesso nome),
 * mantiene `keepId` e cancella gli altri.
 * Le references in `sessione_skills` degli id duplicati vengono spostate su `keepId`
 * (oppure rimosse se la coppia (sessione, keepId) esiste già).
 */
export async function mergeSkillDuplicates(
  keepId: string,
  removeIds: string[]
): Promise<{ error?: string; merged?: number }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();

  if (removeIds.length === 0) return { merged: 0 };

  // Recupera tutte le sessione_skills che puntano agli id da rimuovere
  const { data: refsToMove, error: errFetch } = await sb
    .from("sessione_skills")
    .select("sessione_id, skill_id")
    .in("skill_id", removeIds);

  if (errFetch) return { error: errFetch.message };

  // Recupera sessione_skills che già puntano al keepId per evitare violazioni UNIQUE
  const sessioniInteressate = Array.from(new Set((refsToMove ?? []).map((r) => r.sessione_id)));
  const { data: existingKeep } = sessioniInteressate.length > 0
    ? await sb
        .from("sessione_skills")
        .select("sessione_id")
        .eq("skill_id", keepId)
        .in("sessione_id", sessioniInteressate)
    : { data: [] };

  const existingSet = new Set((existingKeep ?? []).map((r) => r.sessione_id));

  // Inserisci i nuovi link verso keepId solo per le sessioni che non ce l'hanno già
  const toInsert = (refsToMove ?? [])
    .filter((r) => !existingSet.has(r.sessione_id))
    // dedup interno
    .reduce<{ sessione_id: string; skill_id: string }[]>((acc, r) => {
      if (!acc.find((x) => x.sessione_id === r.sessione_id)) {
        acc.push({ sessione_id: r.sessione_id, skill_id: keepId });
      }
      return acc;
    }, []);

  if (toInsert.length > 0) {
    const { error: errIns } = await sb.from("sessione_skills").insert(toInsert);
    if (errIns) return { error: errIns.message };
  }

  // Cancella le skills duplicate (le sessione_skills residue cadono per CASCADE)
  const { error: errDel } = await sb.from("skills").delete().in("id", removeIds);
  if (errDel) return { error: errDel.message };

  revalidatePath("/admin/config/skills");
  return { merged: removeIds.length };
}
