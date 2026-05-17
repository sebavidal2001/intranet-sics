import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { DEFAULT_BI_WIDGETS } from "@/lib/portali/preventivatore/bi/defaults";
import type { BiWidgetConfig } from "@/lib/portali/preventivatore/bi/types";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["kpi", "bar", "stacked_bar", "line", "combo", "donut", "table"]);
const ALLOWED_DATASETS = new Set(["documenti", "righe_distinta"]);
const ALLOWED_FIELDS = new Set([
  "anno", "mese", "cliente", "categoria", "tipo_prodotto", "stato", "tipo", "numero_offerta",
  "importo_preventivo", "importo_ordinato", "codice_articolo", "descrizione", "quantita",
  "prezzo_unitario", "ricarico_pct", "totale_riga",
]);
const ALLOWED_OPS = new Set(["count", "sum", "avg", "min", "max"]);

function validateWidget(widget: Partial<BiWidgetConfig>): BiWidgetConfig | null {
  if (!widget.title || !widget.type || !widget.dataset || !widget.metric) return null;
  if (!ALLOWED_TYPES.has(widget.type) || !ALLOWED_DATASETS.has(widget.dataset)) return null;
  if (!ALLOWED_OPS.has(widget.metric.op)) return null;
  if (widget.metric.field && !ALLOWED_FIELDS.has(widget.metric.field)) return null;
  if (widget.groupBy && !ALLOWED_FIELDS.has(widget.groupBy)) return null;
  if (widget.stackBy && !ALLOWED_FIELDS.has(widget.stackBy)) return null;

  return {
    id: `ai-${Date.now()}`,
    title: String(widget.title).slice(0, 80),
    type: widget.type,
    dataset: widget.dataset,
    x: 0,
    y: 0,
    w: Math.min(12, Math.max(3, Number(widget.w ?? 6))),
    h: Math.min(8, Math.max(2, Number(widget.h ?? 4))),
    metric: {
      op: widget.metric.op,
      field: widget.metric.field,
      label: widget.metric.label,
    },
    secondaryMetric: widget.secondaryMetric && ALLOWED_OPS.has(widget.secondaryMetric.op)
      ? {
          op: widget.secondaryMetric.op,
          field: widget.secondaryMetric.field && ALLOWED_FIELDS.has(widget.secondaryMetric.field) ? widget.secondaryMetric.field : undefined,
          label: widget.secondaryMetric.label,
        }
      : undefined,
    groupBy: widget.groupBy,
    stackBy: widget.stackBy,
    filters: [],
  };
}

function heuristicProposal(prompt: string): BiWidgetConfig {
  const p = prompt.toLowerCase();
  if (p.includes("articol")) return { ...DEFAULT_BI_WIDGETS.find((w) => w.id === "top-articoli")!, id: `ai-${Date.now()}` };
  if (p.includes("cliente")) return { ...DEFAULT_BI_WIDGETS.find((w) => w.id === "value-client")!, id: `ai-${Date.now()}` };
  if (p.includes("categoria") || p.includes("tipologia")) return { ...DEFAULT_BI_WIDGETS.find((w) => w.id === "category-share")!, id: `ai-${Date.now()}` };
  if (p.includes("mese") || p.includes("andamento")) return { ...DEFAULT_BI_WIDGETS.find((w) => w.id === "monthly-category")!, id: `ai-${Date.now()}` };
  return { ...DEFAULT_BI_WIDGETS[1], id: `ai-${Date.now()}`, title: "Valore preventivi proposto" };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = await request.json() as { prompt?: string };
    const prompt = body.prompt?.trim();
    if (!prompt) return NextResponse.json({ error: "Prompt obbligatorio" }, { status: 400 });

    const system = [
      "Sei un configuratore BI per il portale Preventivatore SICS.",
      "Rispondi SOLO con JSON valido.",
      "Crea UN SOLO widget coerente con la richiesta.",
      "Campi consentiti: anno, mese, cliente, categoria, tipo_prodotto, stato, tipo, numero_offerta, importo_preventivo, importo_ordinato, codice_articolo, descrizione, quantita, prezzo_unitario, ricarico_pct, totale_riga.",
      "Dataset consentiti: documenti, righe_distinta.",
      "Tipi consentiti: kpi, bar, stacked_bar, line, combo, donut, table.",
      "Metriche consentite: count, sum, avg, min, max.",
      "Forma JSON: {\"title\":\"...\",\"type\":\"bar\",\"dataset\":\"documenti\",\"w\":6,\"h\":4,\"metric\":{\"op\":\"sum\",\"field\":\"importo_preventivo\",\"label\":\"Valore\"},\"groupBy\":\"cliente\",\"stackBy\":\"categoria\"}",
    ].join("\n");

    let proposed: BiWidgetConfig | null = null;

    if (process.env.OPENROUTER_API_KEY) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://intranet-sics.vercel.app",
          "X-Title": "SICS Preventivatore BI",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4-5",
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 700,
        }),
      });
      if (res.ok) {
        const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
        proposed = validateWidget(parsed);
      }
    }

    proposed ??= heuristicProposal(prompt);
    return NextResponse.json({ widget: proposed });
  } catch (error) {
    console.error("BI ai-propose error:", error);
    const fallback = heuristicProposal("andamento mese categoria");
    return NextResponse.json({ widget: fallback, warning: "Proposta AI non disponibile, usata proposta base." });
  }
}
