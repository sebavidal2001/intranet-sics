import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = "force-dynamic";

interface BloccoVoce {
  tipo: string;
  descrizione: string;
  dimensioni: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json();
    const { blocchi, modalita, oggetto, cliente } = body as {
      blocchi: BloccoVoce[];
      modalita: "preciso" | "creativo";
      oggetto?: string;
      cliente?: string;
    };

    if (!blocchi || !Array.isArray(blocchi) || blocchi.length === 0) {
      return NextResponse.json({ error: "Nessun blocco voce fornito" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const adminClient = createAdminClient();

    // Fetch AI config
    const { data: configRows } = await adminClient
      .schema("preventivatore")
      .from("ai_config")
      .select("chiave, valore");

    const config: Record<string, string> = {};
    for (const row of configRows ?? []) {
      config[row.chiave] = row.valore;
    }

    const systemPromptKey =
      modalita === "preciso" ? "system_prompt_preciso" : "system_prompt_creativo";
    const systemPrompt =
      config[systemPromptKey] ??
      (modalita === "preciso"
        ? "Sei un esperto tecnico di strutture metalliche. Genera una descrizione tecnica precisa basata sui preventivi storici forniti."
        : "Sei un consulente commerciale di strutture metalliche. Genera una proposta commerciale con range di prezzi stimati.");

    const temperaturaKey =
      modalita === "preciso" ? "temperatura_precisa" : "temperatura_creativa";
    const temperatura = parseFloat(config[temperaturaKey] ?? "0.3");
    const modello = config["modello_generazione"] ?? "gemini-2.5-flash";
    const maxChunks = parseInt(config["max_chunks_per_query"] ?? "3", 10);
    const soglia = parseFloat(config["soglia_similarity"] ?? "0.4");

    // Generate embeddings and search for each blocco
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    type FonteChunk = { codice: string; cliente: string; contenuto: string; similarity: number; documento_id: string };
    const allFonti: FonteChunk[] = [];

    for (const blocco of blocchi) {
      const testoBlocco = [
        blocco.tipo,
        blocco.descrizione,
        blocco.dimensioni,
      ]
        .filter(Boolean)
        .join(" ");

      if (!testoBlocco.trim()) continue;

      try {
        const embRes = await embeddingModel.embedContent(testoBlocco);
        const embedding = embRes.embedding.values;

        const { data: chunks } = await adminClient
          .schema("preventivatore")
          .rpc("match_chunks", {
            query_embedding: embedding,
            match_threshold: soglia,
            match_count: maxChunks,
          });

        if (chunks && Array.isArray(chunks)) {
          type ChunkRow = { documento_id: string; similarity: number; contenuto: string };
          const docIds = [...new Set((chunks as ChunkRow[]).map((c) => c.documento_id))];
          const { data: docs } = await adminClient
            .schema("preventivatore")
            .from("documenti")
            .select("id, codice, cliente")
            .in("id", docIds);

          const docMap: Record<string, { codice: string; cliente: string }> = {};
          for (const d of docs ?? []) {
            docMap[d.id] = { codice: d.codice, cliente: d.cliente };
          }

          for (const chunk of chunks as ChunkRow[]) {
            const doc = docMap[chunk.documento_id];
            if (doc) {
              allFonti.push({
                documento_id: chunk.documento_id,
                codice: doc.codice,
                cliente: doc.cliente,
                contenuto: chunk.contenuto,
                similarity: chunk.similarity,
              });
            }
          }
        }
      } catch {
        // skip embedding errors for individual blocks
      }
    }

    // Deduplicate and sort fonti
    const fontiUniche = Object.values(
      allFonti.reduce<Record<string, FonteChunk>>((acc, f) => {
        if (!acc[f.documento_id] || f.similarity > acc[f.documento_id].similarity) {
          acc[f.documento_id] = f;
        }
        return acc;
      }, {})
    ).sort((a, b) => b.similarity - a.similarity);

    // Build context
    const contextParts: string[] = [];
    if (cliente) contextParts.push(`Cliente: ${cliente}`);
    if (oggetto) contextParts.push(`Oggetto: ${oggetto}`);
    contextParts.push("\nVoci del preventivo:");
    for (const b of blocchi) {
      const parts = [b.tipo, b.descrizione, b.dimensioni].filter(Boolean).join(", ");
      if (parts) contextParts.push(`- ${parts}`);
    }

    if (fontiUniche.length > 0) {
      contextParts.push("\n--- Preventivi storici simili ---");
      for (const f of fontiUniche.slice(0, 5)) {
        contextParts.push(
          `Riferimento ${f.codice} (${f.cliente}):\n${f.contenuto.slice(0, 400)}`
        );
      }
    }

    const userMessage = contextParts.join("\n");

    // Call Gemini
    const generationModel = genAI.getGenerativeModel({
      model: modello,
      generationConfig: { temperature: temperatura },
      systemInstruction: systemPrompt,
    });

    const result = await generationModel.generateContent(userMessage);
    const testo = result.response.text();

    const fontiResponse = fontiUniche.map((f) => ({
      codice: f.codice,
      cliente: f.cliente,
      similarity: f.similarity,
    }));

    return NextResponse.json({ testo, fonti: fontiResponse });
  } catch (error) {
    console.error("Genera descrizione error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
