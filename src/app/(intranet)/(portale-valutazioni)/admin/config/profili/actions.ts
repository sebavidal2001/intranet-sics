"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { PORTALE_SLUGS } from "@/lib/config/portali";

type ActionResult = { success: true } | { success: false; error: string };
type ImportResult =
  | { success: true; count: number; errors: string[] }
  | { success: false; error: string; missingParametri?: string[] };
type ImportSkillsResult =
  | { success: true; count: number; errors: string[] }
  | { success: false; error: string };

// ─── HELPER: verifica admin valutazioni ──────────────────────────────────────
async function requireValutazioniAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  return supabase;
}

// ─── HELPER: ottieni portale valutazioni ─────────────────────────────────────
async function getPortaleId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: portale } = await supabase
    .from("portali")
    .select("id")
    .eq("slug", PORTALE_SLUGS.VALUTAZIONI)
    .single();
  return portale?.id ?? null;
}

// ─── RUOLI PROFESSIONALI ──────────────────────────────────────────────────────
const RuoloSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  descrizione: z.string().optional(),
});

export async function createRuoloProfessionale(data: {
  nome: string;
  descrizione?: string;
}): Promise<ActionResult> {
  const supabase = await requireValutazioniAdmin();

  const parsed = RuoloSchema.safeParse(data);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const portaleId = await getPortaleId(supabase);
  if (!portaleId)
    return { success: false, error: "Portale valutazioni non trovato." };

  const { error } = await supabase.from("ruoli_professionali").insert({
    nome: parsed.data.nome,
    descrizione: parsed.data.descrizione ?? null,
    portale_id: portaleId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/config/profili");
  redirect("/admin/config/profili");
}

export async function updateRuoloProfessionale(
  id: string,
  data: { nome: string; descrizione?: string }
): Promise<ActionResult> {
  const supabase = await requireValutazioniAdmin();

  const parsed = RuoloSchema.safeParse(data);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase
    .from("ruoli_professionali")
    .update({
      nome: parsed.data.nome,
      descrizione: parsed.data.descrizione ?? null,
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/config/profili");
  revalidatePath(`/admin/config/profili/${id}`);
  return { success: true };
}

export async function deleteRuoloProfessionale(
  id: string
): Promise<ActionResult> {
  const supabase = await requireValutazioniAdmin();

  const { error } = await supabase
    .from("ruoli_professionali")
    .delete()
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/config/profili");
  redirect("/admin/config/profili");
}

// ─── MANSIONI ─────────────────────────────────────────────────────────────────
const MansioneSchema = z.object({
  ruolo_professionale_id: z.string().uuid("ID ruolo non valido"),
  testo: z.string().min(1, "Testo obbligatorio"),
  parametro_radar_id: z.string().uuid("Seleziona un parametro radar"),
  ordine: z.coerce.number().int().min(0),
});

export async function createMansione(data: {
  ruolo_professionale_id: string;
  testo: string;
  parametro_radar_id: string;
  ordine: number;
}): Promise<ActionResult> {
  const supabase = await requireValutazioniAdmin();

  const parsed = MansioneSchema.safeParse(data);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase.from("mansioni").insert(parsed.data);

  if (error) return { success: false, error: error.message };

  revalidatePath(
    `/admin/config/profili/${parsed.data.ruolo_professionale_id}`
  );
  return { success: true };
}

export async function updateMansione(
  id: string,
  data: {
    testo: string;
    parametro_radar_id: string;
    ordine: number;
  }
): Promise<ActionResult> {
  const supabase = await requireValutazioniAdmin();

  const partial = z
    .object({
      testo: z.string().min(1, "Testo obbligatorio"),
      parametro_radar_id: z.string().uuid("Seleziona un parametro radar"),
      ordine: z.coerce.number().int().min(0),
    })
    .safeParse(data);

  if (!partial.success)
    return { success: false, error: partial.error.errors[0].message };

  const { error } = await supabase
    .from("mansioni")
    .update(partial.data)
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  return { success: true };
}

export async function deleteMansione(
  id: string,
  ruoloId: string
): Promise<ActionResult> {
  const supabase = await requireValutazioniAdmin();

  const { error } = await supabase.from("mansioni").delete().eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/config/profili/${ruoloId}`);
  return { success: true };
}

// ─── IMPORT MANSIONI ──────────────────────────────────────────────────────────
export async function importMansioni(
  rows: { ruolo_professionale: string; parametro: string; mansione: string }[]
): Promise<ImportResult> {
  const supabase = await requireValutazioniAdmin();

  if (!rows.length)
    return { success: false, error: "Nessuna riga da importare." };

  // 1. Carica parametri_radar esistenti
  const { data: parametri, error: errParametri } = await supabase
    .from("parametri_radar")
    .select("id, nome");

  if (errParametri)
    return { success: false, error: errParametri.message };

  const parametriMap = new Map<string, string>(
    (parametri ?? []).map((p) => [p.nome.toLowerCase().trim(), p.id])
  );

  // 2. Trova parametri mancanti
  const parametriRichiesti = [
    ...new Set(rows.map((r) => r.parametro.toLowerCase().trim())),
  ];
  const missingParametri = parametriRichiesti.filter(
    (p) => !parametriMap.has(p)
  );

  if (missingParametri.length > 0) {
    return {
      success: false,
      error: `Parametri radar non trovati: ${missingParametri.join(", ")}`,
      missingParametri,
    };
  }

  // 3. Ottieni portale
  const portaleId = await getPortaleId(supabase);
  if (!portaleId)
    return { success: false, error: "Portale valutazioni non trovato." };

  // 4. Carica ruoli professionali esistenti
  const { data: ruoliEsistenti } = await supabase
    .from("ruoli_professionali")
    .select("id, nome")
    .eq("portale_id", portaleId);

  const ruoliMap = new Map<string, string>(
    (ruoliEsistenti ?? []).map((r) => [r.nome.toLowerCase().trim(), r.id])
  );

  // 5. Crea ruoli mancanti
  const ruoliRichiesti = [
    ...new Set(rows.map((r) => r.ruolo_professionale.trim())),
  ];

  for (const nomeRuolo of ruoliRichiesti) {
    const key = nomeRuolo.toLowerCase();
    if (!ruoliMap.has(key)) {
      const { data: nuovoRuolo, error: errRuolo } = await supabase
        .from("ruoli_professionali")
        .insert({ nome: nomeRuolo, portale_id: portaleId })
        .select("id")
        .single();

      if (errRuolo)
        return {
          success: false,
          error: `Errore creazione ruolo "${nomeRuolo}": ${errRuolo.message}`,
        };

      ruoliMap.set(key, nuovoRuolo.id);
    }
  }

  // 6. Conta mansioni esistenti per ordine — tutte in parallelo
  const ruoloIdList = [...ruoliMap.values()];
  const countResults = await Promise.all(
    ruoloIdList.map((id) =>
      supabase
        .from("mansioni")
        .select("id", { count: "exact", head: true })
        .eq("ruolo_professionale_id", id)
    )
  );
  const ordinePerRuolo = new Map<string, number>();
  ruoloIdList.forEach((id, i) => ordinePerRuolo.set(id, countResults[i].count ?? 0));

  // 7. Costruisci tutti i record con ordine pre-calcolato, poi bulk insert
  const errors: string[] = [];
  const records: { ruolo_professionale_id: string; testo: string; parametro_radar_id: string; ordine: number }[] = [];

  for (const row of rows) {
    const ruoloId = ruoliMap.get(row.ruolo_professionale.toLowerCase().trim());
    const parametroId = parametriMap.get(row.parametro.toLowerCase().trim());

    if (!ruoloId || !parametroId) {
      errors.push(`Riga non valida: ${JSON.stringify(row)}`);
      continue;
    }

    const ordine = ordinePerRuolo.get(ruoloId) ?? 0;
    records.push({ ruolo_professionale_id: ruoloId, testo: row.mansione.trim(), parametro_radar_id: parametroId, ordine });
    ordinePerRuolo.set(ruoloId, ordine + 1);
  }

  let successCount = 0;
  if (records.length > 0) {
    const { error: errBulk } = await supabase.from("mansioni").insert(records);
    if (errBulk) {
      errors.push(`Errore inserimento bulk: ${errBulk.message}`);
    } else {
      successCount = records.length;
    }
  }

  revalidatePath("/admin/config/profili");
  return { success: true, count: successCount, errors };
}

// ─── IMPORT SKILLS ────────────────────────────────────────────────────────────
export async function importSkills(
  rows: { skill: string; parametro: string; descrizione?: string }[]
): Promise<ImportSkillsResult> {
  const supabase = await requireValutazioniAdmin();

  if (!rows.length)
    return { success: false, error: "Nessuna riga da importare." };

  // 1. Carica parametri_radar esistenti
  const { data: parametri, error: errParametri } = await supabase
    .from("parametri_radar")
    .select("id, nome");

  if (errParametri)
    return { success: false, error: errParametri.message };

  const parametriMap = new Map<string, string>(
    (parametri ?? []).map((p) => [p.nome.toLowerCase().trim(), p.id])
  );

  // 2. Verifica parametri mancanti
  const parametriRichiesti = [
    ...new Set(rows.map((r) => r.parametro.toLowerCase().trim())),
  ];
  const missingParametri = parametriRichiesti.filter((p) => !parametriMap.has(p));

  if (missingParametri.length > 0) {
    return {
      success: false,
      error: `Parametri radar non trovati: ${missingParametri.join(", ")}`,
    };
  }

  // 3. Conta skills esistenti per calcolare ordine globale
  const { count: existingCount } = await supabase
    .from("skills")
    .select("id", { count: "exact", head: true });

  const baseOrdine = existingCount ?? 0;

  // 4. Prepara records validi e raccogli errori per righe non risolvibili
  const errors: string[] = [];
  const records: { nome: string; parametro_radar_id: string; descrizione: string | null; ordine: number }[] = [];

  for (const row of rows) {
    const parametroId = parametriMap.get(row.parametro.toLowerCase().trim());
    if (!parametroId) {
      errors.push(`Parametro non trovato: "${row.parametro}"`);
      continue;
    }
    records.push({
      nome: row.skill.trim(),
      parametro_radar_id: parametroId,
      descrizione: row.descrizione?.trim() || null,
      ordine: baseOrdine + records.length,
    });
  }

  // 5. Inserimento batch unico invece di N query sequenziali
  let successCount = 0;
  if (records.length > 0) {
    const { error: errBatch } = await (supabase.from("skills") as unknown as {
      insert: (values: unknown) => Promise<{ error: { message: string } | null }>;
    }).insert(records);

    if (errBatch) {
      errors.push(`Errore inserimento batch: ${errBatch.message}`);
    } else {
      successCount = records.length;
    }
  }

  revalidatePath("/admin/config/profili");
  return { success: true, count: successCount, errors };
}
