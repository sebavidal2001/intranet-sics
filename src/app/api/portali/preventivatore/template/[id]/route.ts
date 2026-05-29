import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

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
    console.error("Template [id] GET error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

type RigaMatIn = {
  slug?: string | null; descrizione: string; codice_articolo?: string | null;
  costo_manuale?: number | null; usa_listino?: boolean; ricarico_default?: number;
  qta_formula?: string | null; qta_manuale?: number; gruppo?: string | null;
  metri_catena?: number; metri_guida?: number;
};
type RigaManIn = {
  label: string; tariffa_default?: number; unita_tempo?: string;
  tempo_formula?: string | null; tempo_default?: number; modalita?: string; ricarico_default?: number;
};

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

    // 1) Campi template
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["nome","descrizione","attivo","ordine","consegna_settimane_min","consegna_settimane_max",
      "imballaggio_pct","tempi_accessori_pct","spese_generali_pct","margine_default_pct",
      "ricarico_materiale_default","ricarico_manodopera_default",
      "usa_catena_guida","costo_catena_m","costo_guida_m",
      "catena_codice","catena_descrizione","catena_ricarico",
      "guida_codice","guida_descrizione","guida_ricarico"]) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    const { error: upErr } = await admin.schema("preventivatore").from("template").update(patch).eq("id", id);
    if (upErr) { console.error(upErr); return NextResponse.json({ error: "Errore aggiornamento template" }, { status: 500 }); }

    // 2) Sostituisci i figli (delete + insert) se forniti
    if (Array.isArray(body.parametri)) {
      await admin.schema("preventivatore").from("template_parametri").delete().eq("template_id", id);
      const rows = (body.parametri as Array<Record<string, unknown>>).map((p, i) => ({
        template_id: id, slug: String(p.slug ?? "").trim(), label: String(p.label ?? "").trim(),
        tipo: p.tipo ?? "number", unita: p.unita ?? null, valore_default: p.valore_default ?? null,
        opzioni: p.opzioni ?? null, ordine: (p.ordine as number) ?? i,
      })).filter((p) => p.slug && p.label);
      if (rows.length) {
        const { error } = await admin.schema("preventivatore").from("template_parametri").insert(rows);
        if (error) { console.error(error); return NextResponse.json({ error: "Errore salvataggio parametri" }, { status: 500 }); }
      }
    }
    if (Array.isArray(body.righe_materiale)) {
      await admin.schema("preventivatore").from("template_righe_materiale").delete().eq("template_id", id);
      const rows = (body.righe_materiale as RigaMatIn[]).map((r, i) => ({
        template_id: id, slug: r.slug || null, descrizione: String(r.descrizione ?? "").trim(),
        codice_articolo: r.codice_articolo || null, costo_manuale: r.costo_manuale ?? null,
        usa_listino: Boolean(r.usa_listino), ricarico_default: r.ricarico_default ?? 0.5,
        qta_formula: r.qta_formula || null, qta_manuale: r.qta_manuale ?? 0, gruppo: r.gruppo || null,
        metri_catena: r.metri_catena ?? 0, metri_guida: r.metri_guida ?? 0, ordine: i,
      })).filter((r) => r.descrizione);
      if (rows.length) {
        const { error } = await admin.schema("preventivatore").from("template_righe_materiale").insert(rows);
        if (error) { console.error(error); return NextResponse.json({ error: "Errore salvataggio materiali" }, { status: 500 }); }
      }
    }
    if (Array.isArray(body.righe_manodopera)) {
      await admin.schema("preventivatore").from("template_righe_manodopera").delete().eq("template_id", id);
      const rows = (body.righe_manodopera as RigaManIn[]).map((r, i) => ({
        template_id: id, label: String(r.label ?? "").trim(), tariffa_default: r.tariffa_default ?? 0,
        unita_tempo: r.unita_tempo === "min" ? "min" : "h", tempo_formula: r.tempo_formula || null,
        tempo_default: r.tempo_default ?? 0, modalita: r.modalita === "una_tantum" ? "una_tantum" : "per_pezzo",
        ricarico_default: r.ricarico_default ?? 0.7, ordine: i,
      })).filter((r) => r.label);
      if (rows.length) {
        const { error } = await admin.schema("preventivatore").from("template_righe_manodopera").insert(rows);
        if (error) { console.error(error); return NextResponse.json({ error: "Errore salvataggio manodopera" }, { status: 500 }); }
      }
    }

    const tpl = await loadTemplateFull(admin, id);
    return NextResponse.json(tpl);
  } catch (error) {
    console.error("Template PATCH error:", error);
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
    if (error) { console.error(error); return NextResponse.json({ error: "Errore eliminazione" }, { status: 500 }); }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Template DELETE error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
