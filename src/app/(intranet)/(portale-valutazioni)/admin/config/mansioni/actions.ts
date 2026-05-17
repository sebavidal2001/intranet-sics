"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireValutazioniAdmin } from "@/lib/auth/require-admin";
import { revalidatePath } from "next/cache";

export async function deleteMansioneGlobal(id: string): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();
  const { error } = await sb.from("mansioni").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/config/mansioni");
  return {};
}

export async function updateMansioneGlobal(
  id: string,
  data: { testo: string; ordine: number; parametro_radar_id: string | null }
): Promise<{ error?: string }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();
  const { error } = await sb
    .from("mansioni")
    .update({ testo: data.testo, ordine: data.ordine, parametro_radar_id: data.parametro_radar_id })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/config/mansioni");
  return {};
}

/**
 * Unisce mansioni duplicate (stesso testo, stesso ruolo professionale).
 * Mantiene `keepId`, sposta le `utente_mansioni` references, cancella le altre.
 */
export async function mergeMansioneDuplicates(
  keepId: string,
  removeIds: string[]
): Promise<{ error?: string; merged?: number }> {
  await requireValutazioniAdmin();
  const sb = createAdminClient();

  if (removeIds.length === 0) return { merged: 0 };

  const { data: refsToMove, error: errFetch } = await sb
    .from("utente_mansioni")
    .select("utente_id, mansione_id")
    .in("mansione_id", removeIds);
  if (errFetch) return { error: errFetch.message };

  const utentiInteressati = Array.from(new Set((refsToMove ?? []).map((r) => r.utente_id)));
  const { data: existingKeep } = utentiInteressati.length > 0
    ? await sb
        .from("utente_mansioni")
        .select("utente_id")
        .eq("mansione_id", keepId)
        .in("utente_id", utentiInteressati)
    : { data: [] };

  const existingSet = new Set((existingKeep ?? []).map((r) => r.utente_id));

  const toInsert = (refsToMove ?? [])
    .filter((r) => !existingSet.has(r.utente_id))
    .reduce<{ utente_id: string; mansione_id: string }[]>((acc, r) => {
      if (!acc.find((x) => x.utente_id === r.utente_id)) {
        acc.push({ utente_id: r.utente_id, mansione_id: keepId });
      }
      return acc;
    }, []);

  if (toInsert.length > 0) {
    const { error: errIns } = await sb.from("utente_mansioni").insert(toInsert);
    if (errIns) return { error: errIns.message };
  }

  const { error: errDel } = await sb.from("mansioni").delete().in("id", removeIds);
  if (errDel) return { error: errDel.message };

  revalidatePath("/admin/config/mansioni");
  return { merged: removeIds.length };
}
