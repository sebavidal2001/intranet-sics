import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { requireDocumentoVisibile } from "@/lib/portali/preventivatore/documento-visibile";
import { logError, logWarn } from "@/lib/logger";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PROMPT_SISTEMA =
  "Sei un assistente tecnico-commerciale di SICS. Ricevi i documenti di un preventivo (testo grezzo estratto da Word/PDF) " +
  "e produci un RIASSUNTO STRUTTURATO ed ESAUSTIVO in italiano, pensato per un commerciale che deve capire rapidamente il preventivo. " +
  "Struttura la risposta in queste sezioni (usando ## come heading markdown):\n" +
  "1. ## Sintesi (2-3 frasi su cosa è stato offerto)\n" +
  "2. ## Cliente e contesto (destinatario, referenti, oggetto)\n" +
  "3. ## Voci principali (elenco numerato con titolo + descrizione tecnica chiave + dimensioni se presenti)\n" +
  "4. ## Compreso/Escluso (se menzionati nel documento)\n" +
  "5. ## Note operative (eventuali condizioni, tempi, esclusioni, particolarità)\n\n" +
  "Importante:\n" +
  "- Riporta SOLO dati presenti nei documenti, non inventare valori.\n" +
  "- Se un'informazione non c'è, non la menzionare.\n" +
  "- Sii conciso ma completo: ogni sezione ha valore informativo, niente fluff.\n" +
  "- Usa terminologia tecnica SICS (ballatoio, nastro, profilato, motoriduttore, ecc.) come la usano nei documenti.";

async function callOpenRouter(testoDocumenti: string, modello: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurata");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://intranet.s-ics.com",
      "X-Title": "SICS preventivatore riassumi",
    },
    body: JSON.stringify({
      model: modello,
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: `Documenti del preventivo da riassumere:\n\n${testoDocumenti}` },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = (json?.error?.message as string) ?? JSON.stringify(json).slice(0, 300);
    throw new Error(`OpenRouter HTTP ${res.status}: ${msg}`);
  }
  type ORResp = { choices?: Array<{ message?: { content?: string } }> };
  const r = json as ORResp;
  const text = r.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("OpenRouter ha restituito una risposta vuota");
  return text.trim();
}

export async function POST(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user, ctx: authCtx } = guard;

    const rl = checkRateLimit(`ai-riassumi:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    const visibilita = await requireDocumentoVisibile(
      { userId: user.id, livello: authCtx.livello },
      id,
    );
    if (!visibilita.ok) {
      return NextResponse.json({ error: visibilita.error }, { status: visibilita.status });
    }

    // Fetch dei chunks Word del documento (preventivo commerciale + note)
    const sb = createAdminClient();
    const { data: docRow, error: docErr } = await sb
      .schema("preventivatore")
      .from("documenti")
      .select("codice, cliente, note, cliente_master_id")
      .eq("id", id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!docRow) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });

    // Scope commerciale: senza questo controllo bastava conoscere un UUID per
    // farsi riassumere dall'AI un preventivo di un cliente fuori portfolio —
    // la lettura qui usa l'admin client, quindi RLS e grant non filtrano nulla.
    const { data: wordChunks, error: chunkErr } = await sb
      .schema("preventivatore")
      .from("chunks")
      .select("contenuto, metadata")
      .eq("documento_id", id)
      .eq("metadata->>source_type", "word")
      .order("chunk_index", { ascending: true });
    if (chunkErr) throw chunkErr;

    const documenti = (wordChunks ?? []) as Array<{ contenuto: string; metadata: Record<string, unknown> | null }>;
    if (documenti.length === 0 && !docRow.note) {
      return NextResponse.json(
        { error: "Nessun documento Word disponibile per questo preventivo" },
        { status: 404 }
      );
    }

    // Costruisci il testo da passare all'AI
    const pezzi: string[] = [];
    if (docRow.codice) pezzi.push(`Codice progetto: ${docRow.codice}`);
    if (docRow.cliente) pezzi.push(`Cliente: ${docRow.cliente}`);
    pezzi.push("");

    for (const c of documenti) {
      const ruolo = (c.metadata?.ruolo_file as string | undefined) ?? "preventivo_commerciale";
      const fileName = (c.metadata?.source_file as string | undefined) ?? "documento";
      pezzi.push(`--- ${fileName} (${ruolo}) ---`);
      pezzi.push(c.contenuto);
      pezzi.push("");
    }
    if (docRow.note) {
      pezzi.push("--- Note testuali documento ---");
      pezzi.push(docRow.note);
    }

    const testoDocumenti = pezzi.join("\n").slice(0, 60000); // safety cap input

    // Tutta l'AI passa da OpenRouter: se il modello principale fallisce si
    // riprova una volta con un modello di riserva.
    let riassunto: string;
    try {
      riassunto = await callOpenRouter(testoDocumenti, "google/gemini-2.5-flash");
    } catch (orErr) {
      logWarn("preventivatore.riassumi", "Modello principale fallito, riprovo con la riserva", { dettaglio: orErr instanceof Error ? orErr.message : orErr });
      riassunto = await callOpenRouter(testoDocumenti, "anthropic/claude-haiku-4.5");
    }

    return NextResponse.json({ riassunto, n_documenti: documenti.length });
  } catch (err) {
    logError("preventivatore.riassumi", "Riassumi documenti error", err);
    return NextResponse.json(
      { error: "Non è stato possibile generare il riassunto. Riprova più tardi." },
      { status: 500 },
    );
  }
}
