"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return supabase;
}

export async function importStoricoPunteggi(
  rows: {
    utente_email: string;
    data_valutazione: string;
    punteggio: number;
    note?: string;
  }[]
): Promise<{ error?: string; inserted?: number; errors?: string[] }> {
  const supabase = await requireAdmin();
  // storico_punteggi non è nei tipi auto-generati: si usa il client admin (untyped)
  const admin = createAdminClient();

  const errs: string[] = [];
  const inserts: {
    utente_id: string;
    data_valutazione: string;
    anno: number;
    punteggio: number;
    note: string | null;
    tipo_fonte: string;
  }[] = [];

  // Carica tutti gli utenti in una sola query (batch invece di N query nel loop)
  const emails = [...new Set(rows.map((r) => r.utente_email))];
  const { data: utentiList } = await supabase
    .from("utenti")
    .select("id, email")
    .in("email", emails);
  const utenteMap = new Map<string, string>(
    (utentiList ?? []).map((u: { id: string; email: string }) => [u.email, u.id] as [string, string])
  );

  for (const row of rows) {
    const utenteId = utenteMap.get(row.utente_email);
    if (!utenteId) {
      errs.push(`Utente non trovato: ${row.utente_email}`);
      continue;
    }

    // Parse date to extract anno
    let anno: number;
    try {
      const parsed = new Date(row.data_valutazione);
      anno = parsed.getFullYear();
      if (isNaN(anno)) throw new Error("Invalid date");
    } catch {
      errs.push(`Data non valida per ${row.utente_email}: ${row.data_valutazione}`);
      continue;
    }

    inserts.push({
      utente_id: utenteId,
      data_valutazione: row.data_valutazione,
      anno,
      punteggio: row.punteggio,
      note: row.note ?? null,
      tipo_fonte: "import",
    });
  }

  if (inserts.length > 0) {
    const { error } = await admin.from("storico_punteggi").insert(inserts);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/storico");
  return { inserted: inserts.length, errors: errs.length > 0 ? errs : undefined };
}

export async function deleteStoricoPunteggio(id: string): Promise<{ error?: string }> {
  await requireAdmin();
  // storico_punteggi non è nei tipi auto-generati: si usa il client admin (untyped)
  const admin = createAdminClient();

  const { error } = await admin.from("storico_punteggi").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/storico");
  return {};
}
