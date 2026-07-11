import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore, scopeAgente } from "@/lib/portali/preventivatore/api-guard";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

type KpiRow = {
  tot_preventivi: number;
  valore_totale: string | number;
  importo_medio: string | number;
  clienti_attivi: number;
  tot_ordinati: number;
  tot_rifiutati: number;
  tot_pending: number;
  tot_preventivi_prec: number;
  valore_totale_prec: string | number;
  importo_medio_prec: string | number;
  clienti_attivi_prec: number;
};

type TopClienteRow = {
  cliente: string;
  preventivi_count: number;
  valore_totale: string | number;
  ordinati_count: number;
};

type SerieMeseRow = {
  mese: string; // ISO date
  preventivi: number;
  valore: string | number;
  ordinati: number;
};

type SerieCategoriaRow = {
  mese: string; // ISO date
  categoria: string;
  preventivi: number;
  valore: string | number;
};

type TopArticoloRow = {
  codice_articolo: string;
  descrizione: string;
  occorrenze: number;
  qta_totale: string | number;
  valore_totale: string | number;
};

type AttivitaRow = {
  id: string;
  codice: string | null;
  cliente: string | null;
  stato: string;
  tipo: string;
  importo: string | number | null;
  data_offerta: string | null;
  created_at: string;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

export async function GET() {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user, ctx } = guard;

    const admin = createAdminClient();
    const sb = admin.schema("preventivatore");

    // Filtro commerciale ristretto: tutte le RPC dashboard accettano p_agente_codice
    // (migration 053). NULL = aggregati globali (admin/back_office/preventivatore).
    const agenteCommerciale = scopeAgente(ctx);

    const [kpiRes, topClientiRes, serieRes, serieCategorieRes, topArticoliRes, attivitaRes, usageRes] = await Promise.all([
      sb.rpc("dashboard_kpi", { window_months: 12, p_agente_codice: agenteCommerciale }),
      sb.rpc("dashboard_top_clienti", { limit_n: 5, window_months: 12, p_agente_codice: agenteCommerciale }),
      sb.rpc("dashboard_serie_mensile", { months: 12, p_agente_codice: agenteCommerciale }),
      sb.rpc("dashboard_serie_mensile_categoria", { months: 12, p_agente_codice: agenteCommerciale }),
      sb.rpc("dashboard_top_articoli", { limit_n: 5, p_agente_codice: agenteCommerciale }),
      sb.rpc("dashboard_attivita_recente", { limit_n: 6, p_agente_codice: agenteCommerciale }),
      sb.from("ai_usage_events")
        .select("cost_amount")
        .eq("user_id", user.id)
        .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    ]);

    const err = kpiRes.error ?? topClientiRes.error ?? serieRes.error ?? serieCategorieRes.error ?? topArticoliRes.error ?? attivitaRes.error;
    if (err) {
      logError("preventivatore.dashboard", "RPC dashboard fallita", err);
      return NextResponse.json({ error: "Errore caricamento dashboard" }, { status: 500 });
    }

    const k = (kpiRes.data?.[0] ?? null) as KpiRow | null;
    const topClienti = (topClientiRes.data ?? []) as TopClienteRow[];
    const serie = (serieRes.data ?? []) as SerieMeseRow[];
    const serieCategorie = (serieCategorieRes.data ?? []) as SerieCategoriaRow[];
    const topArticoli = (topArticoliRes.data ?? []) as TopArticoloRow[];
    const attivita = (attivitaRes.data ?? []) as AttivitaRow[];

    const aiSpesaMese = ((usageRes.data ?? []) as { cost_amount: string | number }[])
      .reduce((sum, r) => sum + Number(r.cost_amount ?? 0), 0);

    const totConfermati = (k?.tot_ordinati ?? 0) + (k?.tot_rifiutati ?? 0);
    const tassoOrdinato = totConfermati > 0 ? Math.round(((k?.tot_ordinati ?? 0) / totConfermati) * 100) : null;

    return NextResponse.json({
      window_months: 12,
      kpi: {
        tot_preventivi: k?.tot_preventivi ?? 0,
        tot_preventivi_delta: pctDelta(k?.tot_preventivi ?? 0, k?.tot_preventivi_prec ?? 0),
        valore_totale: num(k?.valore_totale),
        valore_totale_delta: pctDelta(num(k?.valore_totale), num(k?.valore_totale_prec)),
        importo_medio: num(k?.importo_medio),
        importo_medio_delta: pctDelta(num(k?.importo_medio), num(k?.importo_medio_prec)),
        clienti_attivi: k?.clienti_attivi ?? 0,
        clienti_attivi_delta: pctDelta(k?.clienti_attivi ?? 0, k?.clienti_attivi_prec ?? 0),
        tot_ordinati: k?.tot_ordinati ?? 0,
        tot_rifiutati: k?.tot_rifiutati ?? 0,
        tot_pending: k?.tot_pending ?? 0,
        tasso_ordinato: tassoOrdinato, // null se non c'è ancora workflow stati
        workflow_stati_attivo: totConfermati > 0,
      },
      top_clienti: topClienti.map((c) => ({
        cliente: c.cliente,
        preventivi: Number(c.preventivi_count),
        valore: num(c.valore_totale),
        ordinati: Number(c.ordinati_count),
      })),
      serie_mensile: serie.map((s) => ({
        mese: s.mese,
        preventivi: Number(s.preventivi),
        valore: num(s.valore),
        ordinati: Number(s.ordinati),
        categorie: serieCategorie
          .filter((c) => c.mese === s.mese)
          .map((c) => ({
            categoria: c.categoria,
            preventivi: Number(c.preventivi),
            valore: num(c.valore),
          })),
      })),
      top_articoli: topArticoli.map((a) => ({
        codice: a.codice_articolo,
        descrizione: a.descrizione,
        occorrenze: Number(a.occorrenze),
        qta: num(a.qta_totale),
        valore: num(a.valore_totale),
      })),
      attivita_recente: attivita.map((a) => ({
        id: a.id,
        codice: a.codice,
        cliente: a.cliente,
        stato: a.stato,
        tipo: a.tipo,
        importo: a.importo == null ? null : num(a.importo),
        data_offerta: a.data_offerta,
        created_at: a.created_at,
      })),
      ai: {
        spesa_mese_corrente: aiSpesaMese,
        currency: "usd",
      },
    });
  } catch (error) {
    logError("preventivatore.dashboard", "errore inatteso dashboard", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
