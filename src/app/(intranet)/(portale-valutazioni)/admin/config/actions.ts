"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import {
  ScalaSchema,
  ParametroRadarSchema,
  SessioneSchema,
} from "@/lib/validation/schemas";

type ActionResult = { success: true } | { success: false; error: string };

// ─── HELPER: verifica ruolo admin, ritorna admin client per le scritture ─────
// Il client admin bypassa RLS — la verifica del permesso avviene qui in TS.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return createAdminClient();
}

// ─── SCALE ───────────────────────────────────────────────────────────────────

export async function creaScala(formData: FormData): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    min: formData.get("min"),
    max: formData.get("max"),
  };

  const parsed = ScalaSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { nome, min, max } = parsed.data;

  // Genera labels automatiche
  const labels: Record<string, string> = {};
  for (let i = min; i <= max; i++) {
    labels[String(i)] = formData.get(`label_${i}`) as string || String(i);
  }

  const { error } = await supabase
    .from("scale_valutazione")
    .insert({ nome, min, max, labels });

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

export async function modificaScala(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    min: formData.get("min"),
    max: formData.get("max"),
  };

  const parsed = ScalaSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { nome, min, max } = parsed.data;

  const labels: Record<string, string> = {};
  for (let i = min; i <= max; i++) {
    labels[String(i)] = formData.get(`label_${i}`) as string || String(i);
  }

  const { error } = await supabase
    .from("scale_valutazione")
    .update({ nome, min, max, labels })
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

export async function eliminaScala(scalaId: string): Promise<ActionResult> {
  const supabase = await requireAdmin();
  const { error } = await supabase
    .from("scale_valutazione")
    .delete()
    .eq("id", scalaId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── PARAMETRI RADAR ─────────────────────────────────────────────────────────

export async function creaParametro(formData: FormData): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    descrizione: formData.get("descrizione") || undefined,
    colore: formData.get("colore"),
    ordine: formData.get("ordine"),
  };

  const parsed = ParametroRadarSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase
    .from("parametri_radar")
    .insert(parsed.data);

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

export async function modificaParametro(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    descrizione: formData.get("descrizione") || undefined,
    colore: formData.get("colore"),
    ordine: formData.get("ordine"),
  };

  const parsed = ParametroRadarSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase
    .from("parametri_radar")
    .update(parsed.data)
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

export async function eliminaParametro(id: string): Promise<ActionResult> {
  const supabase = await requireAdmin();
  const { error } = await supabase
    .from("parametri_radar")
    .delete()
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── SESSIONI ────────────────────────────────────────────────────────────────

export async function creaSessione(formData: FormData): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    anno: formData.get("anno"),
    scala_id: formData.get("scala_id"),
  };

  const parsed = SessioneSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase
    .from("sessioni_valutazione")
    .insert({ ...parsed.data, is_aperta: false });

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

// ─── DOMANDE ─────────────────────────────────────────────────────────────────
const DomandaSchema = z.object({
  sessione_id: z.string().uuid(),
  testo: z.string().min(1, "Testo obbligatorio"),
  parametro_id: z.string().uuid("Seleziona un parametro"),
  ordine: z.coerce.number().int().min(0),
});

export async function creaDomanda(formData: FormData): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    sessione_id: formData.get("sessione_id"),
    testo: formData.get("testo"),
    parametro_id: formData.get("parametro_id"),
    ordine: formData.get("ordine"),
  };

  const parsed = DomandaSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase.from("domande").insert(parsed.data);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function eliminaDomanda(
  domandaId: string,
  sessioneId: string
): Promise<ActionResult> {
  const supabase = await requireAdmin();
  const { error } = await supabase
    .from("domande")
    .delete()
    .eq("id", domandaId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/config/sessioni/${sessioneId}/domande`);
  return { success: true };
}

// ─── KPI ─────────────────────────────────────────────────────────────────────
const KpiSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  parametro_id: z.string().uuid().optional().or(z.literal("")),
  operatore: z.enum([">", "<", ">=", "<=", "="]),
  soglia: z.coerce.number(),
  anno: z.coerce.number().int().min(2020).max(2050).optional().or(z.literal("")),
});

export async function creaKpi(formData: FormData): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    parametro_id: formData.get("parametro_id") || "",
    operatore: formData.get("operatore"),
    soglia: formData.get("soglia"),
    anno: formData.get("anno") || "",
  };

  const parsed = KpiSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase.from("kpi_config").insert({
    nome: parsed.data.nome,
    parametro_id: parsed.data.parametro_id || null,
    operatore: parsed.data.operatore,
    soglia: parsed.data.soglia,
    anno: parsed.data.anno || null,
  });

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

export async function modificaKpi(id: string, formData: FormData): Promise<ActionResult> {
  const supabase = await requireAdmin();

  const raw = {
    nome: formData.get("nome"),
    parametro_id: formData.get("parametro_id") || "",
    operatore: formData.get("operatore"),
    soglia: formData.get("soglia"),
    anno: formData.get("anno") || "",
  };

  const parsed = KpiSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message };

  const { error } = await supabase
    .from("kpi_config")
    .update({
      nome: parsed.data.nome,
      parametro_id: parsed.data.parametro_id || null,
      operatore: parsed.data.operatore,
      soglia: parsed.data.soglia,
      anno: typeof parsed.data.anno === "number" ? parsed.data.anno : null,
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  redirect("/admin/config");
}

export async function eliminaKpi(id: string): Promise<ActionResult> {
  const supabase = await requireAdmin();
  const { error } = await supabase.from("kpi_config").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/config");
  return { success: true };
}
