import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

    const body = await request.json();
    const { query, filtro_stato, filtro_cliente } = body as {
      query: string;
      filtro_stato?: string;
      filtro_cliente?: string;
    };

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json({ error: "Query obbligatoria" }, { status: 400 });
    }

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
      console.error("RPC match_chunks error:", rpcError);
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

    if (filtro_stato && filtro_stato !== "tutti") {
      documentiQuery = documentiQuery.eq("stato", filtro_stato);
    }
    if (filtro_cliente) {
      documentiQuery = documentiQuery.ilike("cliente", `%${filtro_cliente}%`);
    }

    const { data: documenti, error: docError } = await documentiQuery;
    if (docError) {
      console.error("Documenti fetch error:", docError);
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
    console.error("Search preventivatore error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
