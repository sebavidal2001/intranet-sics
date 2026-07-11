"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const BlockSchema = z.object({
  tipo: z.enum(["news", "link"]),
  titolo: z.string().min(1, "Il titolo è obbligatorio"),
  testo: z.string().optional(),
  url: z.string().url("URL non valido").optional().or(z.literal("")),
  icona: z.string().optional(),
  ordine: z.coerce.number().int().default(0),
});

export type ActionResult = { success: true } | { success: false; error: string };

export async function creaBlock(formData: FormData): Promise<ActionResult> {
  await requireSuperadmin();
  const raw = {
    tipo: formData.get("tipo"),
    titolo: formData.get("titolo"),
    testo: formData.get("testo") ?? undefined,
    url: formData.get("url") ?? "",
    icona: formData.get("icona") ?? undefined,
    ordine: formData.get("ordine") ?? 0,
  };

  const parsed = BlockSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("homepage_blocks").insert({
    tipo: parsed.data.tipo,
    titolo: parsed.data.titolo,
    testo: parsed.data.testo || null,
    url: parsed.data.url || null,
    icona: parsed.data.icona || null,
    ordine: parsed.data.ordine,
    is_attivo: true,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/superadmin/homepage");
  return { success: true };
}

export async function toggleAttivoBlock(id: string, isAttivo: boolean): Promise<void> {
  await requireSuperadmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("homepage_blocks")
    .update({ is_attivo: isAttivo })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/superadmin/homepage");
}

export async function eliminaBlock(id: string): Promise<void> {
  await requireSuperadmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("homepage_blocks")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/superadmin/homepage");
}

export async function aggiornaBlock(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireSuperadmin();
  const raw = {
    tipo: formData.get("tipo"),
    titolo: formData.get("titolo"),
    testo: formData.get("testo") ?? undefined,
    url: formData.get("url") ?? "",
    icona: formData.get("icona") ?? undefined,
    ordine: formData.get("ordine") ?? 0,
  };

  const parsed = BlockSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("homepage_blocks")
    .update({
      titolo: parsed.data.titolo,
      testo: parsed.data.testo || null,
      url: parsed.data.url || null,
      icona: parsed.data.icona || null,
      ordine: parsed.data.ordine,
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/superadmin/homepage");
  return { success: true };
}
