import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import {
  chiamaOpenRouterChat,
  registraUsage,
  risolveModello,
  type ChatMsg,
} from "@/lib/portali/preventivatore/scheda-tecnica/ai";
import { logError, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/portali/preventivatore/scheda-tecnica/revisiona
 *
 * Chat di revisione della scheda già generata: l'utente chiede una modifica
 * ("togli le quantità", "accorpa le sezioni") e l'AI restituisce la scheda
 * RISCRITTA per intero.
 *
 * Scelte importanti:
 *  - Si parte SEMPRE dal testo corrente inviato dal client (`scheda_corrente`),
 *    non dall'ultima versione prodotta dall'AI: così le modifiche fatte a mano
 *    nell'anteprima non vengono perse.
 *  - NON si rimandano gli esempi storici: servono alla prima stesura, qui
 *    farebbero solo lievitare i token.
 *  - L'output è SOLO il markdown della scheda (nessun commento), perché va
 *    direttamente nell'anteprima editabile.
 *
 * Body: { scheda_corrente, istruzione, storico?: [{ruolo, testo}], scheda_id? }
 * Out:  { contenuto_md, costo, modello }
 */

type MessaggioRevisione = { ruolo: "utente" | "ai"; testo: string };

type RequestBody = {
  scheda_corrente: string;
  istruzione: string;
  storico?: MessaggioRevisione[];
  scheda_id?: string | null;
};

const SYSTEM_REVISIONE = [
  "Sei un redattore tecnico-commerciale SICS. Ricevi una DESCRIZIONE DI FORNITURA già redatta e una richiesta di modifica.",
  "",
  "REGOLE:",
  "- Restituisci SEMPRE la scheda COMPLETA e riscritta, in markdown, pronta da usare.",
  "- NON aggiungere commenti, premesse, spiegazioni o testo fuori dalla scheda.",
  "- Applica SOLO la modifica richiesta: tutto il resto deve restare IDENTICO parola per parola.",
  "- Non introdurre dati non presenti nella scheda o nella richiesta dell'utente.",
  "- Mantieni le regole della scheda SICS: niente prezzi, niente codici interni, niente lavorazioni/ore, niente tabelle.",
].join("\n");

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = (await request.json()) as RequestBody;
    const schedaCorrente = (body?.scheda_corrente ?? "").trim();
    const istruzione = (body?.istruzione ?? "").trim();
    if (!schedaCorrente) return NextResponse.json({ error: "scheda_corrente obbligatoria" }, { status: 400 });
    if (!istruzione) return NextResponse.json({ error: "istruzione obbligatoria" }, { status: 400 });
    if (istruzione.length > 2000) return NextResponse.json({ error: "Richiesta troppo lunga (max 2000 caratteri)" }, { status: 400 });

    const cfg = await loadAiConfig();
    const { provider, model } = risolveModello(cfg.modello_scheda_tecnica, cfg.modello_generazione);
    if (provider !== "openrouter") {
      return NextResponse.json({ error: "Provider Gemini non supportato per la revisione" }, { status: 500 });
    }
    const temperature = Math.max(0, Math.min(1, parseFloat(cfg.temperatura_scheda_tecnica ?? "0.4") || 0.4));

    // Lo storico serve al modello per capire il filo del discorso (es. "no, intendevo
    // l'altra sezione"): teniamo solo gli ultimi scambi per non gonfiare i token.
    const storico = (Array.isArray(body.storico) ? body.storico : []).slice(-6);
    const messaggiStorico: ChatMsg[] = storico.map((m) => ({
      role: m.ruolo === "utente" ? "user" : "assistant",
      content: m.ruolo === "utente" ? m.testo : "(scheda aggiornata)",
    }));

    const messages: ChatMsg[] = [
      { role: "system", content: SYSTEM_REVISIONE },
      ...messaggiStorico,
      {
        role: "user",
        content: [
          "SCHEDA ATTUALE (fonte di verità: parti da questa, include eventuali modifiche manuali):",
          "---",
          schedaCorrente,
          "---",
          "",
          `MODIFICA RICHIESTA: ${istruzione}`,
          "",
          "Rispondi con la scheda completa aggiornata, senza altro testo.",
        ].join("\n"),
      },
    ];

    const { content, usage } = await chiamaOpenRouterChat({
      model,
      messages,
      temperature,
      maxTokens: 8192,
      title: "SICS Scheda Tecnica — revisione",
    });

    const nuovaScheda = content.trim();
    if (!nuovaScheda) {
      return NextResponse.json({ error: "L'AI non ha restituito la scheda revisionata" }, { status: 502 });
    }

    await registraUsage({ userId: user.id, model, modalita: "scheda_revisione", usage });

    // Storico revisioni sulla scheda (audit + materiale per migliorare il prompt).
    if (body.scheda_id) {
      try {
        const admin = createAdminClient();
        const { data: row } = await admin
          .schema("preventivatore")
          .from("schede_generate")
          .select("revisioni")
          .eq("id", body.scheda_id)
          .maybeSingle();
        const precedenti = Array.isArray(row?.revisioni) ? (row!.revisioni as unknown[]) : [];
        await admin
          .schema("preventivatore")
          .from("schede_generate")
          .update({
            revisioni: [
              ...precedenti,
              { ruolo: "utente", testo: istruzione, at: new Date().toISOString() },
              { ruolo: "ai", testo: "(scheda riscritta)", at: new Date().toISOString(), costo: usage?.cost ?? null },
            ],
            contenuto_md: nuovaScheda,
          })
          .eq("id", body.scheda_id);
      } catch (e) {
        logWarn("preventivatore.scheda-tecnica", "salvataggio revisione fallito", { dettaglio: String(e) });
      }
    }

    return NextResponse.json({
      contenuto_md: nuovaScheda,
      costo: usage?.cost ?? null,
      modello: model,
    });
  } catch (err) {
    logError("preventivatore.scheda-tecnica", "revisione scheda error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore revisione scheda" },
      { status: 500 }
    );
  }
}
