import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

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
    const body = await request.json();

    // Solo i campi forniti vengono aggiornati
    const patch: Record<string, unknown> = {};
    if (body.nome !== undefined) patch.nome = String(body.nome).trim();
    if (body.categoria !== undefined) patch.categoria = String(body.categoria).trim() || "Manodopera";
    if (body.tariffa_ora !== undefined) patch.tariffa_ora = Number(body.tariffa_ora) || 0;
    if (body.unita !== undefined) patch.unita = String(body.unita).trim() || "h";
    if (body.ordine !== undefined) patch.ordine = Number(body.ordine) || 0;
    if (body.is_attivo !== undefined) patch.is_attivo = Boolean(body.is_attivo);

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
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo")
      .single();

    if (error) {
      console.error("Servizio update error:", error);
      return NextResponse.json({ error: "Errore aggiornamento servizio" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Servizi PATCH error:", error);
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
      console.error("Servizio delete error:", error);
      return NextResponse.json({ error: "Errore eliminazione servizio" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Servizi DELETE error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
