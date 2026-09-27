import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { logError } from "@/lib/logger";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { validateFormula } from "@/lib/portali/preventivatore/template/formula";
import type { TemplateParametro, TemplateRigaManodopera, TemplateRigaMateriale } from "@/lib/portali/preventivatore/template/types";
import { LIMITI_TEMPLATE_DOCUMENTO } from "@/lib/portali/preventivatore/documenti-schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/portali/preventivatore/template/ai-genera
 * Body: { richiesta: string, bozza?: object }  (bozza = template corrente da migliorare)
 * Risposta: { template: {...} }  (JSON conforme allo schema editor; NON salva)
 *
 * L'AI compila/corregge un template; l'utente poi modifica e salva manualmente.
 */

const SYSTEM = `Sei un assistente che configura TEMPLATE di preventivo per SICS (nastri trasportatori, scale, protezioni, telai, pezzi di lavorazione).
Devi tradurre la richiesta in testo dell'utente in un template strutturato in JSON.

Un template ha:
- parametri di input (es. larghezza, altezza, n_gradini): ognuno ha slug (minuscolo, snake_case, niente spazi), label, tipo ("number"|"select"|"bool"), unita (es. "mm"), valore_default, opzioni (solo se select).
- righe_materiale: distinta. Ogni riga: slug (opzionale, per referenziarla in altre formule), descrizione, codice_articolo (se noto), costo_manuale (se nessun codice), ricarico_default (coefficiente SICS 0-1, es. 0.65), qta_formula (espressione) OPPURE qta_manuale, gruppo.
- righe_manodopera: ognuna ha label, tariffa_default (€/h), unita_tempo ("min"|"h"), tempo_formula o tempo_default, modalita ("per_pezzo"|"una_tantum"), ricarico_default (es. 0.7).
- costanti: imballaggio_pct (1), tempi_accessori_pct (2.8), spese_generali_pct (24.2), margine_default_pct (5), consegna_settimane_min, consegna_settimane_max.

SINTASSI FORMULE (qta_formula / tempo_formula): aritmetica + - * /, parentesi, confronti, AND/OR/NOT,
funzioni IF(cond,a,b), MIN, MAX, ROUND, CEIL, FLOOR, ABS. Riferisci i parametri per slug
(es. "(larghezza/1000)*n_gradini") e le altre righe materiale per il loro slug (es. "fiancate*2").
Decimali col punto. NON usare nomi/slug non definiti.

Convenzione SICS: prezzo_vendita = costo / ricarico (ricarico 0.5 = +100%). Una tantum = lavoro non
moltiplicato per i pezzi (es. progettazione); per_pezzo = ripetuto per ogni pezzo.

Rispondi SOLO con un JSON valido:
{
  "nome": "...", "descrizione": "...",
  "parametri": [{"slug":"...","label":"...","tipo":"number","unita":"mm","valore_default":"0"}],
  "righe_materiale": [{"slug":"...","descrizione":"...","codice_articolo":null,"costo_manuale":0,"ricarico_default":0.5,"qta_formula":"...","qta_manuale":0,"gruppo":"materie_prime"}],
  "righe_manodopera": [{"label":"...","tariffa_default":27.98,"unita_tempo":"h","tempo_formula":null,"tempo_default":0,"modalita":"per_pezzo","ricarico_default":0.7}],
  "costanti": {"imballaggio_pct":1,"tempi_accessori_pct":2.8,"spese_generali_pct":24.2,"margine_default_pct":5,"consegna_settimane_min":4,"consegna_settimane_max":6}
}
Nessun testo prima o dopo il JSON.`;

const slugSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "slug non valido").max(100);
const parametroSchema = z.object({
  slug: slugSchema,
  label: z.string().trim().min(1).max(500),
  tipo: z.enum(["number", "select", "bool"]),
  unita: z.string().max(100).nullable().optional(),
  valore_default: z.string().max(500).nullable().optional(),
  opzioni: z.array(z.string().max(500)).max(100).nullable().optional(),
}) satisfies z.ZodType<TemplateParametro>;
const materialeSchema = z.object({
  slug: slugSchema.nullable().optional(),
  descrizione: z.string().trim().min(1).max(LIMITI_TEMPLATE_DOCUMENTO.descrizione),
  codice_articolo: z.string().trim().max(LIMITI_TEMPLATE_DOCUMENTO.codiceArticolo).nullable().optional(),
  costo_manuale: z.number().finite().min(0).nullable().optional(),
  usa_listino: z.boolean().optional(),
  ricarico_default: z.number().finite().positive().max(1),
  qta_formula: z.string().max(2_000).nullable().optional(),
  qta_manuale: z.number().finite().min(0).optional(),
  gruppo: z.string().max(LIMITI_TEMPLATE_DOCUMENTO.categoria).nullable().optional(),
}) satisfies z.ZodType<TemplateRigaMateriale>;
const manodoperaSchema = z.object({
  label: z.string().trim().min(1).max(LIMITI_TEMPLATE_DOCUMENTO.nomeLavorazione),
  tariffa_default: z.number().finite().min(0).max(LIMITI_TEMPLATE_DOCUMENTO.tariffa),
  unita_tempo: z.enum(["min", "h"]),
  tempo_formula: z.string().max(2_000).nullable().optional(),
  tempo_default: z.number().finite().min(0).optional(),
  modalita: z.enum(["per_pezzo", "una_tantum"]),
  ricarico_default: z.number().finite().positive().max(1),
}) satisfies z.ZodType<TemplateRigaManodopera>;
const templateSchema = z.object({
  nome: z.string().trim().min(1).max(500),
  descrizione: z.string().max(LIMITI_TEMPLATE_DOCUMENTO.descrizione).nullable().optional(),
  parametri: z.array(parametroSchema).max(100),
  righe_materiale: z.array(materialeSchema).max(500),
  righe_manodopera: z.array(manodoperaSchema).max(200),
  costanti: z.object({
    imballaggio_pct: z.number().finite().min(0).max(100),
    tempi_accessori_pct: z.number().finite().min(0).max(100),
    spese_generali_pct: z.number().finite().min(0).max(100),
    margine_default_pct: z.number().finite().min(0).max(100),
    consegna_settimane_min: z.number().int().min(0).max(520),
    consegna_settimane_max: z.number().int().min(0).max(520),
  }).refine((c) => c.consegna_settimane_max >= c.consegna_settimane_min, "Intervallo consegna non valido"),
});
const bodySchema = z.object({
  richiesta: z.string().trim().min(1, "Richiesta mancante").max(10_000),
  bozza: z.unknown().optional(),
}).superRefine((value, ctx) => {
  if (value.bozza !== undefined && Buffer.byteLength(JSON.stringify(value.bozza), "utf8") > 200_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bozza"], message: "Bozza troppo grande" });
  }
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const rl = checkRateLimit(`ai-tpl:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    const bodyResult = bodySchema.safeParse(await request.json().catch(() => null));
    if (!bodyResult.success) return NextResponse.json({ error: bodyResult.error.issues[0]?.message ?? "Payload non valido" }, { status: 400 });
    const body = bodyResult.data;
    const richiesta = body.richiesta;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENROUTER_API_KEY non configurata" }, { status: 500 });

    const cfg = await loadAiConfig();
    // Priorità: modello dedicato template → scheda tecnica → chat → fallback.
    const modelRaw = (cfg.modello_template?.trim() || cfg.modello_scheda_tecnica?.trim() || cfg.modello_generazione?.trim() || "openrouter:anthropic/claude-sonnet-4.5");
    const model = modelRaw.startsWith("openrouter:") ? modelRaw.slice("openrouter:".length) : modelRaw;

    const userPrompt = [
      "Richiesta dell'utente:",
      richiesta,
      body?.bozza ? "\nBozza attuale da correggere/migliorare (JSON):\n" + JSON.stringify(body.bozza) : "",
    ].join("\n");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "SICS Template AI" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt }],
        temperature: 0.2, max_tokens: 4096,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return NextResponse.json({ error: e?.error?.message ?? `OpenRouter HTTP ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    let parsed: unknown = null;
    try {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch { parsed = null; }
    if (!parsed) return NextResponse.json({ error: "Risposta AI non interpretabile", raw: content.slice(0, 500) }, { status: 502 });

    const templateResult = templateSchema.safeParse(parsed);
    if (!templateResult.success) {
      return NextResponse.json({
        error: "La bozza AI non rispetta il formato del template",
        dettagli: templateResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }, { status: 502 });
    }
    const template = templateResult.data;
    const allowed = new Set<string>(template.parametri.map((p) => p.slug));
    for (const riga of template.righe_materiale) if (riga.slug) allowed.add(riga.slug);
    const formule = [
      ...template.righe_materiale.flatMap((riga, index) => riga.qta_formula ? [{ campo: `righe_materiale.${index}.qta_formula`, formula: riga.qta_formula }] : []),
      ...template.righe_manodopera.flatMap((riga, index) => riga.tempo_formula ? [{ campo: `righe_manodopera.${index}.tempo_formula`, formula: riga.tempo_formula }] : []),
    ];
    const formuleNonValide = formule.flatMap(({ campo, formula }) => {
      const result = validateFormula(formula, allowed);
      return result.ok ? [] : [`${campo}: ${result.error ?? "formula non valida"}`];
    });
    if (formuleNonValide.length > 0) {
      return NextResponse.json({ error: "La bozza AI contiene formule non valide", dettagli: formuleNonValide }, { status: 502 });
    }

    const codici = [...new Set(template.righe_materiale.map((r) => r.codice_articolo?.trim()).filter((c): c is string => Boolean(c)))];
    const avvisi: string[] = [];
    if (codici.length > 0) {
      const { data: prodotti, error: prodottiError } = await createAdminClient().schema("preventivatore")
        .from("v_prodotti_costo").select("codice").in("codice", codici);
      if (prodottiError) throw prodottiError;
      const trovati = new Set((prodotti ?? []).map((p) => String(p.codice)));
      for (const codice of codici) if (!trovati.has(codice)) avvisi.push(`Codice articolo non trovato: ${codice}`);
    }

    return NextResponse.json({ template, avvisi });
  } catch (error) {
    logError("preventivatore.template.ai-genera", "Template ai-genera error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Errore del server" }, { status: 500 });
  }
}
