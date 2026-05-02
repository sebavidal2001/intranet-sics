"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

// ─── Tipi comuni ────────────────────────────────────────────────────────────

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

// ─── Schema portale ──────────────────────────────────────────────────────────

const PortaleSchema = z.object({
  nome: z.string().min(1, "Il nome è obbligatorio"),
  slug: z
    .string()
    .min(1, "Lo slug è obbligatorio")
    .regex(/^[a-z0-9-]+$/, "Slug non valido (solo lettere minuscole, numeri e trattini)"),
  descrizione: z.string().optional(),
  icona: z.string().optional(),
  colore: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido")
    .default("#00a1be"),
  ordine: z.coerce.number().int().min(0).default(0),
  is_attivo: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .transform((v) => v === true || v === "true"),
});

// ─── creaPortale ────────────────────────────────────────────────────────────

export async function creaPortale(formData: FormData): Promise<ActionResult> {
  const raw = {
    nome: formData.get("nome"),
    slug: formData.get("slug"),
    descrizione: formData.get("descrizione") ?? undefined,
    icona: formData.get("icona") ?? undefined,
    colore: formData.get("colore") ?? "#00a1be",
    ordine: formData.get("ordine") ?? 0,
    is_attivo: formData.get("is_attivo") ?? "true",
  };

  const parsed = PortaleSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("portali").insert({
    nome: parsed.data.nome,
    slug: parsed.data.slug,
    descrizione: parsed.data.descrizione ?? null,
    icona: parsed.data.icona ?? null,
    colore: parsed.data.colore,
    ordine: parsed.data.ordine,
    is_attivo: parsed.data.is_attivo,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  redirect("/superadmin/portali");
}

// ─── modificaPortale ─────────────────────────────────────────────────────────

export async function modificaPortale(formData: FormData): Promise<ActionResult> {
  const id = formData.get("id");
  if (!id || typeof id !== "string") {
    return { success: false, error: "ID portale mancante" };
  }

  const raw = {
    nome: formData.get("nome"),
    slug: formData.get("slug"),
    descrizione: formData.get("descrizione") ?? undefined,
    icona: formData.get("icona") ?? undefined,
    colore: formData.get("colore") ?? "#00a1be",
    ordine: formData.get("ordine") ?? 0,
    is_attivo: formData.get("is_attivo") ?? "false",
  };

  const parsed = PortaleSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("portali")
    .update({
      nome: parsed.data.nome,
      slug: parsed.data.slug,
      descrizione: parsed.data.descrizione ?? null,
      icona: parsed.data.icona ?? null,
      colore: parsed.data.colore,
      ordine: parsed.data.ordine,
      is_attivo: parsed.data.is_attivo,
    })
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  redirect("/superadmin/portali");
}

export async function toggleAttivoPortale(id: string, isAttivo: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("portali")
    .update({ is_attivo: isAttivo })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/superadmin/portali");
}

export type PermessiRuoloUpdate = {
  portaleId: string;
  ruolo: string;
  can_access: boolean;
  can_export: boolean;
  can_approve: boolean;
};

export async function upsertPermessoRuolo(data: PermessiRuoloUpdate): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("permessi_portale").upsert(
    {
      portale_id: data.portaleId,
      ruolo: data.ruolo,
      can_access: data.can_access,
      can_export: data.can_export,
      can_approve: data.can_approve,
    },
    { onConflict: "portale_id,ruolo" }
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/superadmin/portali/${data.portaleId}/permessi`);
}

export type PermessiUtenteUpdate = {
  portaleId: string;
  utenteId: string;
  override_access: boolean | null;
  override_export: boolean | null;
  is_portal_admin?: boolean;
};

export async function upsertPermessoUtente(data: PermessiUtenteUpdate): Promise<void> {
  const supabase = await createClient();

  // Costruisce la riga: include is_portal_admin solo se esplicitamente passato
  type PermessiUtenteInsert = {
    portale_id: string;
    utente_id: string;
    override_access: boolean | null;
    override_export: boolean | null;
    is_portal_admin?: boolean;
  };
  const row: PermessiUtenteInsert = {
    portale_id: data.portaleId,
    utente_id: data.utenteId,
    override_access: data.is_portal_admin ? true : data.override_access,
    override_export: data.is_portal_admin ? true : data.override_export,
    ...(data.is_portal_admin !== undefined ? { is_portal_admin: data.is_portal_admin } : {}),
  };

  const { error } = await supabase.from("permessi_utente").upsert(
    row,
    { onConflict: "portale_id,utente_id" }
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/superadmin/portali/${data.portaleId}/permessi`);
}

export async function eliminaPermessoUtente(portaleId: string, utenteId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("permessi_utente")
    .delete()
    .eq("portale_id", portaleId)
    .eq("utente_id", utenteId);

  if (error) throw new Error(error.message);
  revalidatePath(`/superadmin/portali/${portaleId}/permessi`);
}
