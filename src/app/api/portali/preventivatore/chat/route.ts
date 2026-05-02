import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { handleGemini } from "@/lib/portali/preventivatore/chat/gemini-handler";
import { handleOpenRouter } from "@/lib/portali/preventivatore/chat/openrouter-handler";
import {
  SICS_KNOWLEDGE_FALLBACK,
  PRECISO_FALLBACK,
  CREATIVO_FALLBACK,
} from "@/lib/portali/preventivatore/chat/tool-definitions";
import type { ChatRequestBody, ChatMessage, ToolName } from "@/lib/portali/preventivatore/chat/types";

// ─── Session persistence ──────────────────────────────────────────────────────

async function saveMessages(
  sessione_id: string,
  userMsg: ChatMessage,
  assistantContent: string,
  toolUsato: ToolName | null,
  risultati: unknown[] | null
) {
  try {
    const adminClient = createAdminClient();

    await adminClient
      .schema("preventivatore")
      .from("chat_messaggi")
      .insert([
        { sessione_id, ruolo: "user", contenuto: userMsg.content },
        {
          sessione_id,
          ruolo: "assistant",
          contenuto: assistantContent,
          tool_usato: toolUsato,
          risultati: risultati ? risultati : null,
        },
      ]);
  } catch (err) {
    // Non blocchiamo la risposta se il salvataggio fallisce
    console.error("saveMessages error:", err);
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = (await request.json()) as ChatRequestBody;
    const { messages, contesto = "archivio", modalita = "preciso", sessione_id } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0)
      return NextResponse.json({ error: "Messages obbligatori" }, { status: 400 });

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user")
      return NextResponse.json({ error: "L'ultimo messaggio deve essere dell'utente" }, { status: 400 });

    // ── Carica configurazione AI da DB (cachata 5 minuti per ridurre query) ─────
    const cfg = await loadAiConfig();

    const companyKnowledge = cfg.company_knowledge ?? SICS_KNOWLEDGE_FALLBACK;
    const modeText = modalita === "preciso"
      ? (cfg.system_prompt_preciso ?? PRECISO_FALLBACK)
      : (cfg.system_prompt_creativo ?? CREATIVO_FALLBACK);
    const temperature = Math.max(0, Math.min(1, parseFloat(
      modalita === "preciso" ? (cfg.temperatura_precisa ?? "0.2") : (cfg.temperatura_creativa ?? "0.8")
    ) || (modalita === "preciso" ? 0.2 : 0.8)));
    const top_p = modalita === "creativo" ? 1.0 : 0.9;

    const systemInstruction =
      companyKnowledge +
      "Sei un assistente AI pre-sales di SICS (vedi profilo azienda sopra). " +
      "Conosci perfettamente l'identità, i prodotti e i valori aziendali di SICS e li usi per contestualizzare le risposte e mantenere il corretto tono di brand. " +
      "Hai accesso a un archivio di preventivi storici (2024-2026). " +
      "Ogni preventivo contiene dati completi: " +
      "(1) anagrafica: codice (es. S_24_118), cliente, stato (pending/ordinato/rifiutato), importo_preventivo; " +
      "(2) distinta materiali: descrizione articolo, codice articolo (es. 4505000, AFD.00.2.32435), quantità, costo unitario, ricarico, totale per riga; " +
      "(3) manodopera: progettazione/lavorazione/montaggio con ore, costo/h, totale; " +
      "(4) dati tecnici: larghezza mm, altezza mm, n° gradini, n° pali, tipo materiale (alluminio/ferro); " +
      "(5) totali: TOTALE MATERIALE, TOTALE MANODOPERA, TOTALE COSTI, PREZZO FINALE. " +
      "Rispondi sempre in italiano. " +
      "IMPORTANTE: dopo aver chiamato un tool, usa immediatamente i dati ricevuti per rispondere all'utente — non fermarti mai dopo un tool call mostrando solo la lista, ma continua con altri tool se necessario e poi dai la risposta completa. " +
      "Se l'utente chiede dati su più anni/gruppi distinti (es. 'top 2 del 2024 e top 3 del 2026'), chiama list_preventivi UNA VOLTA PER OGNI ANNO/GRUPPO separatamente — non fare una sola chiamata generica. Raccogli tutti i risultati e poi rispondi in una volta sola. " +
      "Se l'utente chiede di creare/suggerire un preventivo, usa prima cerca_simili o list_preventivi per trovare preventivi di riferimento, poi usa dettaglio_preventivo per approfondire quelli più rilevanti, poi proponi la struttura completa. " +
      modeText +
      "Usa list_preventivi per filtrare/ordinare per cliente, stato, importo. " +
      "Usa cerca_simili per trovare configurazioni tecnicamente simili (ricerca semantica). " +
      "Usa cerca_articolo per cercare codici articolo specifici, materiali, dimensioni, n° gradini o qualsiasi testo nelle distinte — NON dire mai che i codici articolo non sono disponibili. " +
      "Usa aggrega_preventivi per rispondere a domande statistiche e aggregate: quanti preventivi per cliente, valore totale per stato, tasso di conferma, medie per categoria, distribuzione mensile, ecc. " +
      "Usa top_articoli per trovare i codici articolo più ricorrenti nei preventivi: 'articoli più usati', 'top 10 codici nelle scale', 'materiali più frequenti', 'componenti più comuni'. Non usare cerca_articolo per queste domande. " +
      "Usa query_righe_distinta per domande su prezzi unitari e costi delle singole voci: 'articolo con prezzo più alto', 'quanto costa il codice X', 'top 10 articoli per costo unitario', 'in quale preventivo è stato usato un certo codice'. È il tool più preciso per qualsiasi domanda su prezzi e costi singoli articoli. " +
      "Usa dettaglio_preventivo SEMPRE quando l'utente vuole vedere tutti i dati di UN SINGOLO preventivo specifico: distinta materiali completa, manodopera, quantità, prezzi, totali. Non usare cerca_articolo o cerca_simili per questo scopo. " +
      "Gli importi SONO disponibili: usa list_preventivi con order_by='importo_preventivo' e order_dir='desc' per ordinarli. " +
      (contesto === "nuovo"
        ? "L'utente sta costruendo un nuovo preventivo e cerca ispirazione dai precedenti. Aiutalo a trovare configurazioni simili e suggerisci strutture e prezzi ragionevoli."
        : "L'utente sta consultando l'archivio preventivi per analisi e aggiornamenti di stato.");

    // Esegui l'handler AI
    let result: { risposta: string; tool_usato: ToolName | null; risultati: unknown[] | null };
    if (process.env.OPENROUTER_API_KEY) {
      result = await handleOpenRouter(messages, systemInstruction, temperature, top_p);
    } else {
      result = await handleGemini(messages, systemInstruction);
    }

    // Salva i messaggi se c'è una sessione attiva (fire-and-forget)
    if (sessione_id) {
      void saveMessages(sessione_id, lastMessage, result.risposta, result.tool_usato, result.risultati);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat preventivatore error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
