import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { logError } from "@/lib/logger";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const rl = checkRateLimit(`ai-tpl:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    const body = await request.json().catch(() => ({}));
    const richiesta = String(body?.richiesta ?? "").trim();
    if (!richiesta) return NextResponse.json({ error: "Richiesta mancante" }, { status: 400 });

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

    return NextResponse.json({ template: parsed });
  } catch (error) {
    logError("preventivatore.template.ai-genera", "Template ai-genera error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Errore del server" }, { status: 500 });
  }
}
