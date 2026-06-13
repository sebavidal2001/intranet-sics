import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function loadTemplateFull(admin: ReturnType<typeof createAdminClient>, idOrSlug: string) {
  const col = UUID_RE.test(idOrSlug) ? "id" : "slug";
  const { data: tpl, error } = await admin
    .schema("preventivatore").from("template").select("*").eq(col, idOrSlug).maybeSingle();
  if (error) throw error;
  if (!tpl) return null;
  const tplId = (tpl as { id: string }).id;

  const [paramRes, matRes, manRes] = await Promise.all([
    admin.schema("preventivatore").from("template_parametri").select("*").eq("template_id", tplId).order("ordine"),
    admin.schema("preventivatore").from("template_righe_materiale").select("*").eq("template_id", tplId).order("ordine"),
    admin.schema("preventivatore").from("template_righe_manodopera").select("*").eq("template_id", tplId).order("ordine"),
  ]);
  if (paramRes.error) throw paramRes.error;
  if (matRes.error) throw matRes.error;
  if (manRes.error) throw manRes.error;

  const righeMat = (matRes.data ?? []) as Array<Record<string, unknown>>;

  // Risolvi costi correnti dall'anagrafica per i codici (no listino)
  const codici = Array.from(new Set(
    righeMat.filter((r) => !r.usa_listino && r.codice_articolo).map((r) => r.codice_articolo as string)
  ));
  const costo = new Map<string, number>();
  const dataC = new Map<string, string | null>();
  if (codici.length > 0) {
    const { data: prod } = await admin
      .schema("preventivatore").from("prodotti")
      .select("codice, ult_costo, data_ult_costo").in("codice", codici);
    for (const p of (prod ?? []) as Array<{ codice: string; ult_costo: number | null; data_ult_costo: string | null }>) {
      if (p.ult_costo != null) costo.set(p.codice, Number(p.ult_costo));
      dataC.set(p.codice, p.data_ult_costo);
    }
  }
  const righeMatRis = righeMat.map((r) => ({
    ...r,
    costo_corrente: r.codice_articolo ? (costo.get(r.codice_articolo as string) ?? null) : null,
    data_ult_costo: r.codice_articolo ? (dataC.get(r.codice_articolo as string) ?? null) : null,
  }));

  return {
    ...(tpl as Record<string, unknown>),
    parametri: paramRes.data ?? [],
    righe_materiale: righeMatRis,
    righe_manodopera: manRes.data ?? [],
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const tpl = await loadTemplateFull(createAdminClient(), id);
    if (!tpl) return NextResponse.json({ error: "Template non trovato" }, { status: 404 });
    return NextResponse.json(tpl);
  } catch (error) {
    logError("preventivatore.template", "Template [id] GET error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Payload mancante" }, { status: 400 });
    const admin = createAdminClient();

    // Salvataggio ATOMICO (update template + replace figli) in un'unica transazione.
    const { error: rpcErr } = await admin
      .schema("preventivatore")
      .rpc("salva_template_full", { p_id: id, p_payload: body });
    if (rpcErr) {
      logError("preventivatore.template", "salva_template_full error", rpcErr);
      return NextResponse.json({ error: "Errore salvataggio template" }, { status: 500 });
    }

    const tpl = await loadTemplateFull(admin, id);
    return NextResponse.json(tpl);
  } catch (error) {
    logError("preventivatore.template", "Template PATCH error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const admin = createAdminClient();
    const { error } = await admin.schema("preventivatore").from("template").delete().eq("id", id);
    if (error) { logError("preventivatore.template", "errore", error); return NextResponse.json({ error: "Errore eliminazione" }, { status: 500 }); }
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("preventivatore.template", "Template DELETE error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
