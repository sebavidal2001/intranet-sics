"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

type ActionResult = { error?: string; data?: unknown };

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return createAdminClient();
}

export async function createSessioneUtente(data: {
  utente_id: string;
  data_programmata: string;
  scala_id: string;
  anno: number;
  note_admin?: string;
  orario?: string;
  tipo_valutazione?: string;
}): Promise<ActionResult> {
  const supabase = await requireAdmin();

  // Copia responsabile_id dall'utente
  const { data: utente, error: errUtente } = await supabase
    .from("utenti")
    .select("responsabile_id")
    .eq("id", data.utente_id)
    .single();

  if (errUtente) return { error: errUtente.message };

  // Se l'utente non ha un responsabile, diventa responsabile di sé stesso
  const responsabile_id = utente?.responsabile_id ?? data.utente_id;
  // Auto-avvia la valutazione se è auto-referenziale (superadmin senza responsabile)
  const statoIniziale = responsabile_id === data.utente_id ? "resp_in_corso" : "programmata";

  const { data: created, error } = await supabase
    .from("sessioni_utente")
    .insert({
      utente_id: data.utente_id,
      responsabile_id,
      scala_id: data.scala_id,
      anno: data.anno,
      data_programmata: data.data_programmata,
      stato: statoIniziale,
      note_admin: data.note_admin ?? null,
      orario: data.orario ?? null,
      tipo_valutazione: data.tipo_valutazione ?? "annuale",
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/admin/calendario");
  return { data: created };
}

export async function updateSessioneUtente(
  id: string,
  data: {
    data_programmata?: string;
    stato?: string;
    note_admin?: string;
    scala_id?: string;
    orario?: string | null;
  }
): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const { error } = await supabase
    .from("sessioni_utente")
    .update(data)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/calendario");
  return {};
}

export async function deleteSessioneUtente(id: string): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const { error } = await supabase
    .from("sessioni_utente")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/calendario");
  return {};
}
