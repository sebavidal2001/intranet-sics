import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getFiltroCommerciale, getIdClientiVisibili } from "@/lib/portali/preventivatore/ruoli";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { idsMasterPerRagioneSociale } from "@/lib/portali/preventivatore/clienti-filtro";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// La query finisce in un embedding a pagamento: limitarne la lunghezza evita
// sia costi anomali sia payload giganti verso Gemini.
const SearchBodySchema = z.object({
  query: z.string().trim().min(1, "Query obbligatoria").max(1000),
  filtro_stato: z.string().trim().max(32).optional(),
  filtro_cliente: z.string().trim().max(200).optional(),
  filtro_destinazione_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Portale access check
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    // Ogni ricerca genera un embedding Gemini a pagamento: senza limite una
    // sola sessione può bruciare quota indefinitamente.
    const rl = checkRateLimit(`ai-search:${user.id}`, { limit: 30, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    const rawBody = await request.json().catch(() => null);
    const parsed = SearchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { query, filtro_stato, filtro_cliente, filtro_destinazione_id } = parsed.data;

    // Generate embedding
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const embeddingResult = await embeddingModel.embedContent(query.trim());
    const queryEmbedding = embeddingResult.embedding.values;

    // Search via admin client (schema preventivatore)
    const adminClient = createAdminClient();

    const { data: chunks, error: rpcError } = await adminClient
      .schema("preventivatore")
      .rpc("match_chunks", {
        query_embedding: queryEmbedding,
        match_threshold: 0.4,
        match_count: 20,
      });

    if (rpcError) {
      logError("preventivatore.search", "RPC match_chunks error", rpcError);
      return NextResponse.json(
        { error: "Errore ricerca vettoriale" },
        { status: 500 }
      );
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json([]);
    }

    // Get document IDs from chunks
    const documentoIds = [...new Set((chunks as Array<{ documento_id: string; similarity: number; contenuto: string }>).map((c) => c.documento_id))];

    // Fetch documents
    let documentiQuery = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("id, codice, cliente, stato, categoria, numero_offerta, data_offerta")
      .in("id", documentoIds);

    // Filtro commerciale: nasconde i documenti di clienti fuori portfolio (anche dalla RAG)
    const agenteCommerciale = await getFiltroCommerciale(user.id, livello);
    if (agenteCommerciale) {
      const idsVisibili = await getIdClientiVisibili(agenteCommerciale);
      if (idsVisibili.length === 0) {
        return NextResponse.json([]);
      }
      documentiQuery = documentiQuery.in("cliente_master_id", idsVisibili);
    }

    if (filtro_stato && filtro_stato !== "tutti") {
      documentiQuery = documentiQuery.eq("stato", filtro_stato);
    }
    if (filtro_cliente) {
      // Stessa risoluzione della lista archivio: il filtro arriva come ragione
      // sociale del master, che con un ilike sul TEXT non intercetterebbe le
      // varianti storiche ("ALPHAMAC srl" non matcha "ALPHAMAC").
      const idsCliente = await idsMasterPerRagioneSociale(filtro_cliente);
      documentiQuery = idsCliente.length > 0
        ? documentiQuery.in("cliente_master_id", idsCliente)
        : documentiQuery.eq("cliente", filtro_cliente);
    }
    // Secondo livello (sede/divisione), come nella lista classica: senza questo
    // il filtro sarebbe attivo a video ma ignorato in modalità AI.
    if (filtro_destinazione_id && /^[0-9a-f-]{36}$/i.test(filtro_destinazione_id)) {
      documentiQuery = documentiQuery.eq("cliente_master_id", filtro_destinazione_id);
    }

    const { data: documenti, error: docError } = await documentiQuery;
    if (docError) {
      logError("preventivatore.search", "Documenti fetch error", docError);
      return NextResponse.json({ error: "Errore recupero documenti" }, { status: 500 });
    }

    // Group chunks by documento_id
    type ChunkRow = { documento_id: string; similarity: number; contenuto: string };
    const chunksByDoc = (chunks as ChunkRow[]).reduce<Record<string, ChunkRow[]>>(
      (acc, chunk) => {
        if (!acc[chunk.documento_id]) acc[chunk.documento_id] = [];
        acc[chunk.documento_id].push(chunk);
        return acc;
      },
      {}
    );

    // Build results
    const risultati = (documenti ?? []).map((doc) => {
      const docChunks = chunksByDoc[doc.id] ?? [];
      const maxSimilarity = docChunks.length > 0
        ? Math.max(...docChunks.map((c) => c.similarity))
        : 0;
      const topChunk = docChunks.sort((a, b) => b.similarity - a.similarity)[0];

      return {
        documento_id: doc.id,
        codice: doc.codice,
        cliente: doc.cliente,
        stato: doc.stato,
        categoria: doc.categoria,
        similarity: maxSimilarity,
        n_chunks: docChunks.length,
        top_chunk_contenuto: topChunk?.contenuto ?? "",
        numero_offerta: doc.numero_offerta,
        data_offerta: doc.data_offerta,
      };
    });

    // Sort by similarity descending
    risultati.sort((a, b) => b.similarity - a.similarity);

    return NextResponse.json(risultati);
  } catch (error) {
    logError("preventivatore.search", "Search preventivatore error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
