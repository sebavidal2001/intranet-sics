"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireValutazioniAdmin } from "@/lib/auth/require-admin";
import { revalidatePath } from "next/cache";

export async function createSkill(data: {
  ruolo_professionale_id: string;
  nome: string;
  descrizione?: string;
  ordine: number;
}): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase.from("skills").insert({
    ruolo_professionale_id: data.ruolo_professionale_id,
    nome: data.nome,
    descrizione: data.descrizione ?? null,
    ordine: data.ordine,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/config/profili/${data.ruolo_professionale_id}/skills`);
  return {};
}

export async function updateSkill(
  id: string,
  ruoloProfessionaleId: string,
  data: { nome: string; descrizione?: string; ordine: number }
): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("skills")
    .update({
      nome: data.nome,
      descrizione: data.descrizione ?? null,
      ordine: data.ordine,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/admin/config/profili/${ruoloProfessionaleId}/skills`);
  return {};
}

export async function deleteSkill(
  id: string,
  ruoloProfessionaleId: string
): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase.from("skills").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/admin/config/profili/${ruoloProfessionaleId}/skills`);
  return {};
}

export async function importSkillsXlsx(
  ruoloProfessionaleId: string,
  rows: { nome: string; descrizione?: string; ordine?: number }[]
): Promise<{ error?: string; inserted?: number }> {
  await requireValutazioniAdmin();
  const supabase = createAdminClient();

  const inserts = rows.map((r, i) => ({
    ruolo_professionale_id: ruoloProfessionaleId,
    nome: r.nome,
    descrizione: r.descrizione ?? null,
    ordine: r.ordine ?? i,
  }));

  const { error, data } = await supabase.from("skills").insert(inserts).select("id");

  if (error) return { error: error.message };

  revalidatePath(`/admin/config/profili/${ruoloProfessionaleId}/skills`);
  return { inserted: data?.length ?? 0 };
}
