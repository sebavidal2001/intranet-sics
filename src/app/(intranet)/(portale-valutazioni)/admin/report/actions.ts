"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import type { BloccoInput } from "@/lib/types";

type ActionResult = { success: true } | { success: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return { supabase, admin: createAdminClient(), userId: user.id };
}

export async function creaReport(data: {
  nome: string;
  descrizione: string;
  visibilita_ruoli: string[];
  is_attivo: boolean;
  blocchi: BloccoInput[];
}): Promise<ActionResult> {
  const { admin, userId } = await requireAdmin();

  const { data: report, error } = await admin
    .from("report_config")
    .insert({
      nome: data.nome.trim(),
      descrizione: data.descrizione.trim() || null,
      visibilita_ruoli: data.visibilita_ruoli,
      is_attivo: data.is_attivo,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !report) return { success: false, error: error?.message ?? "Errore creazione" };

  if (data.blocchi.length > 0) {
    const { error: blocchiError } = await admin.from("report_blocchi").insert(
      data.blocchi.map((b, i) => ({
        report_id: report.id,
        ordine: i,
        tipo: b.tipo,
        titolo: b.titolo || null,
        configurazione: b.configurazione,
      }))
    );
    if (blocchiError) return { success: false, error: blocchiError.message };
  }

  revalidatePath("/admin/report");
  redirect("/admin/report");
}

export async function modificaReport(
  id: string,
  data: {
    nome: string;
    descrizione: string;
    visibilita_ruoli: string[];
    is_attivo: boolean;
    blocchi: BloccoInput[];
  }
): Promise<ActionResult> {
  const { admin } = await requireAdmin();

  const { error } = await admin
    .from("report_config")
    .update({
      nome: data.nome.trim(),
      descrizione: data.descrizione.trim() || null,
      visibilita_ruoli: data.visibilita_ruoli,
      is_attivo: data.is_attivo,
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  // Strategia replace-all blocchi: delete + insert
  await admin.from("report_blocchi").delete().eq("report_id", id);

  if (data.blocchi.length > 0) {
    const { error: blocchiError } = await admin.from("report_blocchi").insert(
      data.blocchi.map((b, i) => ({
        report_id: id,
        ordine: i,
        tipo: b.tipo,
        titolo: b.titolo || null,
        configurazione: b.configurazione,
      }))
    );
    if (blocchiError) return { success: false, error: blocchiError.message };
  }

  revalidatePath("/admin/report");
  revalidatePath(`/admin/report/${id}`);
  redirect(`/admin/report/${id}`);
}

export async function eliminaReport(id: string): Promise<ActionResult> {
  const { admin } = await requireAdmin();
  const { error } = await admin.from("report_config").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/report");
  return { success: true };
}

export async function toggleAttivoReport(id: string, isAttivo: boolean): Promise<ActionResult> {
  const { admin } = await requireAdmin();
  const { error } = await admin.from("report_config").update({ is_attivo: isAttivo }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/report");
  return { success: true };
}
