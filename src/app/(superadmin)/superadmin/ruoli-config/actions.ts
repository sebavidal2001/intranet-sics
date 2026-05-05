"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireSuperadmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();

  if (profile?.ruolo !== "superadmin") redirect("/");
}

// === RUOLI CONFIG ===

export async function createRuolo(data: {
  nome: string;
  slug: string;
  colore: string;
  ordine: number;
}): Promise<{ error?: string }> {
  await requireSuperadmin();
  const supabase = createAdminClient();

  const { error } = await supabase.from("ruoli_config").insert({
    nome: data.nome,
    slug: data.slug,
    colore: data.colore,
    ordine: data.ordine,
    is_system: false,
  });

  if (error) {
    if (error.code === "23505") return { error: `Esiste già un ruolo con slug "${data.slug}".` };
    return { error: error.message };
  }

  revalidatePath("/superadmin/ruoli-config");
  return {};
}

export async function updateRuolo(
  id: string,
  data: { nome: string; colore: string; ordine: number }
): Promise<{ error?: string }> {
  await requireSuperadmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("ruoli_config")
    .update({ nome: data.nome, colore: data.colore, ordine: data.ordine })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/superadmin/ruoli-config");
  return {};
}

export async function deleteRuolo(id: string): Promise<{ error?: string }> {
  await requireSuperadmin();
  const supabase = createAdminClient();

  // Can only delete non-system ruoli
  const { data: ruolo } = await supabase
    .from("ruoli_config")
    .select("is_system")
    .eq("id", id)
    .single();

  if (ruolo?.is_system) {
    return { error: "Non è possibile eliminare un ruolo di sistema." };
  }

  const { error } = await supabase.from("ruoli_config").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/superadmin/ruoli-config");
  return {};
}

// === REPARTI ===

export async function createReparto(data: {
  nome: string;
  descrizione?: string;
  ordine: number;
}): Promise<{ error?: string }> {
  await requireSuperadmin();
  const supabase = createAdminClient();

  const { error } = await supabase.from("reparti").insert({
    nome: data.nome,
    descrizione: data.descrizione ?? null,
    ordine: data.ordine,
    attivo: true,
  });

  if (error) {
    if (error.code === "23505") return { error: `Esiste già un reparto con nome "${data.nome}".` };
    return { error: error.message };
  }

  revalidatePath("/superadmin/ruoli-config");
  return {};
}

export async function updateReparto(
  id: string,
  data: {
    nome: string;
    descrizione?: string;
    ordine: number;
    attivo: boolean;
  }
): Promise<{ error?: string }> {
  await requireSuperadmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("reparti")
    .update({
      nome: data.nome,
      descrizione: data.descrizione ?? null,
      ordine: data.ordine,
      attivo: data.attivo,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/superadmin/ruoli-config");
  return {};
}

export async function deleteReparto(id: string): Promise<{ error?: string }> {
  await requireSuperadmin();
  const supabase = createAdminClient();

  const { error } = await supabase.from("reparti").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/superadmin/ruoli-config");
  return {};
}
