"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { z } from "zod";
import { usernameToEmailNew, USERNAME_EMAIL_DOMAIN } from "@/lib/auth/username";

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

const NuovoUtenteSchema = z.object({
  nome: z.string().min(1, "Il nome è obbligatorio"),
  cognome: z.string().min(1, "Il cognome è obbligatorio"),
  username: z
    .string()
    .min(3, "Username minimo 3 caratteri")
    .regex(/^[a-zA-Z0-9._-]+$/, "Username non valido (solo lettere, numeri, . _ -)"),
  password: z.string().min(8, "Password minimo 8 caratteri"),
  ruolo: z.string().min(1, "Il ruolo è obbligatorio"),
  reparto: z.string().optional(),
  responsabile_id: z.string().uuid().optional().or(z.literal("")),
  stato: z.enum(["attivo", "inattivo"]).default("attivo"),
  data_assunzione: z.string().optional(),
});

export type NuovoUtenteFormData = z.infer<typeof NuovoUtenteSchema>;

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

export async function creaUtente(
  formData: FormData
): Promise<ActionResult> {
  await requireSuperadmin();
  const raw = {
    nome: formData.get("nome"),
    cognome: formData.get("cognome"),
    username: formData.get("username"),
    password: formData.get("password"),
    ruolo: formData.get("ruolo"),
    reparto: formData.get("reparto") ?? undefined,
    responsabile_id: formData.get("responsabile_id") ?? "",
    stato: formData.get("stato") ?? "attivo",
    data_assunzione: formData.get("data_assunzione") ?? undefined,
  };

  const parsed = NuovoUtenteSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return { success: false, error: firstError.message };
  }

  const { nome, cognome, username, password, ruolo, reparto, responsabile_id, stato, data_assunzione } =
    parsed.data;

  const adminClient = createAdminClient();

  const email = usernameToEmailNew(username);

  // Crea utente in Supabase Auth passando i dati nei metadati
  // così il trigger handle_new_user crea già la riga utenti corretta
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      nome,
      cognome,
      username,
      ruolo,
      reparto: reparto ?? "",
    },
  });

  if (authError || !authData.user) {
    return {
      success: false,
      error: authError?.message ?? "Errore durante la creazione dell'utente Auth",
    };
  }

  const userId = authData.user.id;

  const updateFields: Record<string, unknown> = {
    nome,
    cognome,
    username,
    ruolo,
    reparto: reparto ?? "",
    responsabile_id: responsabile_id || null,
    stato,
  };
  if (data_assunzione) updateFields.data_assunzione = data_assunzione;

  // Upsert con adminClient per bypassare RLS
  // (il trigger potrebbe aver già inserito la riga, quindi usiamo upsert)
  const { error: updateError } = await adminClient
    .from("utenti")
    .upsert(
      { id: userId, email, ...updateFields },
      { onConflict: "id" }
    );

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  redirect("/superadmin/utenti");
}

const ModificaUtenteSchema = z.object({
  nome: z.string().min(1, "Il nome è obbligatorio"),
  cognome: z.string().min(1, "Il cognome è obbligatorio"),
  username: z
    .string()
    .min(3, "Username minimo 3 caratteri")
    .regex(/^[a-zA-Z0-9._-]+$/, "Username non valido (solo lettere, numeri, . _ -)"),
  password: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 8, {
      message: "Password minimo 8 caratteri",
    }),
  ruolo: z.string().min(1, "Il ruolo è obbligatorio"),
  reparto: z.string().optional(),
  responsabile_id: z.string().uuid().optional().or(z.literal("")),
  stato: z.enum(["attivo", "inattivo"]).default("attivo"),
  data_assunzione: z.string().optional(),
});

/**
 * Allinea l'email di tutti gli utenti che hanno un'email "tecnica" (legacy `@sics.interno`),
 * oppure che hanno una mail nulla/vuota ma username valorizzato, sostituendola con
 * `username@s-ics.com`. Aggiorna sia `auth.users` sia la tabella `utenti`.
 */
export async function allineaEmailUtenti(): Promise<{
  success: boolean;
  updated: number;
  skipped: { id: string; username: string | null; email: string | null; motivo: string }[];
  error?: string;
}> {
  await requireSuperadmin();
  const adminClient = createAdminClient();

  // Carica tutti gli utenti
  const { data: utenti, error: fetchErr } = await adminClient
    .from("utenti")
    .select("id, username, email");
  if (fetchErr) {
    return { success: false, updated: 0, skipped: [], error: fetchErr.message };
  }

  const skipped: { id: string; username: string | null; email: string | null; motivo: string }[] = [];
  let updated = 0;

  for (const u of (utenti ?? []) as { id: string; username: string | null; email: string | null }[]) {
    const currentEmail = (u.email ?? "").toLowerCase();
    const username = (u.username ?? "").trim();

    const isLegacy =
      currentEmail.endsWith("@sics.interno") ||
      currentEmail === "" ||
      currentEmail === null;

    if (!isLegacy) continue;

    if (!username) {
      skipped.push({ id: u.id, username: u.username, email: u.email, motivo: "Username mancante: impossibile generare email" });
      continue;
    }

    const newEmail = `${username.toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
    if (newEmail === currentEmail) continue;

    // 1) Aggiorna in auth.users
    const { error: authErr } = await adminClient.auth.admin.updateUserById(u.id, {
      email: newEmail,
      email_confirm: true,
    });
    if (authErr) {
      skipped.push({ id: u.id, username, email: u.email, motivo: `Auth update: ${authErr.message}` });
      continue;
    }

    // 2) Aggiorna in tabella utenti
    const { error: dbErr } = await adminClient
      .from("utenti")
      .update({ email: newEmail })
      .eq("id", u.id);
    if (dbErr) {
      skipped.push({ id: u.id, username, email: u.email, motivo: `DB update: ${dbErr.message}` });
      continue;
    }

    updated++;
  }

  return { success: true, updated, skipped };
}

export async function modificaUtente(
  formData: FormData
): Promise<ActionResult> {
  await requireSuperadmin();
  const id = formData.get("id");
  if (!id || typeof id !== "string") {
    return { success: false, error: "ID utente mancante" };
  }

  const raw = {
    nome: formData.get("nome"),
    cognome: formData.get("cognome"),
    username: formData.get("username"),
    password: formData.get("password") ?? undefined,
    ruolo: formData.get("ruolo"),
    reparto: formData.get("reparto") ?? undefined,
    responsabile_id: formData.get("responsabile_id") ?? "",
    stato: formData.get("stato") ?? "attivo",
    data_assunzione: formData.get("data_assunzione") ?? undefined,
  };

  const parsed = ModificaUtenteSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return { success: false, error: firstError.message };
  }

  const { nome, cognome, username, password, ruolo, reparto, responsabile_id, stato, data_assunzione } =
    parsed.data;

  const adminClient = createAdminClient();

  if (password && password.length > 0) {
    const { error: authError } = await adminClient.auth.admin.updateUserById(id, {
      password,
    });
    if (authError) {
      return { success: false, error: authError.message };
    }
  }

  const updateFields: Record<string, unknown> = {
    nome,
    cognome,
    username,
    ruolo,
    reparto: reparto ?? "",
    responsabile_id: responsabile_id || null,
    stato,
  };
  if (data_assunzione !== undefined) updateFields.data_assunzione = data_assunzione || null;

  const { error: updateError } = await adminClient
    .from("utenti")
    .update(updateFields)
    .eq("id", id);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  redirect("/superadmin/utenti");
}
