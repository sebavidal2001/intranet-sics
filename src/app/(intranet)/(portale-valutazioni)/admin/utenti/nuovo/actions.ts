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

const NuovoUtenteSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  cognome: z.string().min(1, "Cognome obbligatorio"),
  email: z.string().email("Email non valida"),
  password: z.string().min(6, "Password minimo 6 caratteri"),
  ruolo: z.enum(["collaboratore", "responsabile", "responsabile_intermedio", "admin", "amministratore"]),
  reparto: z.string().optional(),
  responsabile_id: z.string().uuid().optional().nullable(),
});

export async function creaUtente(formData: FormData): Promise<ActionResult> {
  const db = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    cognome: formData.get("cognome"),
    email: formData.get("email"),
    password: formData.get("password"),
    ruolo: formData.get("ruolo"),
    reparto: formData.get("reparto") || undefined,
    responsabile_id: formData.get("responsabile_id") || null,
  };

  const parsed = NuovoUtenteSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message };

  const { nome, cognome, email, password, ruolo, reparto, responsabile_id } = parsed.data;

  // Crea utente in Supabase Auth
  const { data: authUser, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) return { success: false, error: authError.message };

  // Inserisce nella tabella utenti
  const { error: dbError } = await db
    .from("utenti")
    .insert({
      id: authUser.user.id,
      nome,
      cognome,
      email,
      ruolo,
      reparto: reparto ?? null,
      responsabile_id: responsabile_id ?? null,
      stato: "attivo",
    });

  if (dbError) {
    // Rollback: elimina l'utente auth appena creato
    await db.auth.admin.deleteUser(authUser.user.id);
    return { success: false, error: dbError.message };
  }

  revalidatePath("/admin/utenti");
  redirect("/admin/utenti");
}
