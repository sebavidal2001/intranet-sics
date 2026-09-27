import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";
import { ServizioConfigurazioneSchema } from "@/lib/portali/preventivatore/documenti-schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const aggiornaServizioSchema = ServizioConfigurazioneSchema.partial().extend({
  unita: z.string().trim().min(1).max(16).optional(),
  ordine: z.number().finite().nonnegative().optional(),
  is_attivo: z.boolean().optional(),
  scala_con_quantita: z.boolean().optional(),
});

/**
 * PATCH  — aggiorna un servizio/lavorazione (solo admin del portale)
 * DELETE — elimina un servizio/lavorazione (solo admin del portale)
 *
 * Tabella: preventivatore.servizi_manodopera
 */

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato", status: 401 as const };
  const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
  if (!hasMinLivello(livello, "admin")) return { error: "Accesso negato", status: 403 as const };
  return { ok: true as const };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const parsed = aggiornaServizioSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payload non valido" }, { status: 400 });
    }

    // Solo i campi forniti vengono aggiornati
    const patch: Record<string, unknown> = { ...parsed.data };
    if (patch.categoria === "") patch.categoria = "Manodopera";

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .update(patch)
      .eq("id", id)
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo, scala_con_quantita")
      .single();

    if (error) {
      logError("preventivatore.servizi", "Servizio update error", error);
      return NextResponse.json({ error: "Errore aggiornamento servizio" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    logError("preventivatore.servizi", "Servizi PATCH error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const adminClient = createAdminClient();
    const { error } = await adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .delete()
      .eq("id", id);

    if (error) {
      logError("preventivatore.servizi", "Servizio delete error", error);
      return NextResponse.json({ error: "Errore eliminazione servizio" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("preventivatore.servizi", "Servizi DELETE error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
