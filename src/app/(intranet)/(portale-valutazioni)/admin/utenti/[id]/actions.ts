"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type ActionResult = { success: true } | { success: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return createAdminClient();
}

const UtenteSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  cognome: z.string().min(1, "Cognome obbligatorio"),
  ruolo: z.enum(["collaboratore", "responsabile", "responsabile_intermedio", "admin", "amministratore"]),
  reparto: z.string().optional(),
  responsabile_id: z.string().uuid().optional().nullable(),
  stato: z.enum(["attivo", "inattivo"]),
});

export async function aggiornaUtente(id: string, formData: FormData): Promise<ActionResult> {
  const db = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    cognome: formData.get("cognome"),
    ruolo: formData.get("ruolo"),
    reparto: formData.get("reparto") || undefined,
    responsabile_id: formData.get("responsabile_id") || null,
    stato: formData.get("stato"),
  };

  const parsed = UtenteSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message };

  const { error } = await db
    .from("utenti")
    .update(parsed.data)
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/utenti");
  redirect("/admin/utenti");
}
