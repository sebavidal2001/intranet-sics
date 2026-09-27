import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { getPreventivatoreScope } from "@/lib/portali/preventivatore/ruoli";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";
import { getCachedEmbedding } from "@/lib/portali/preventivatore/chat/embedding-cache";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { idsMasterPerRagioneSociale } from "@/lib/portali/preventivatore/clienti-filtro";

export const dynamic = "force-dynamic";

const SearchBodySchema = z.object({
  query: z.string().trim().min(1, "Query obbligatoria").max(1000),
  filtro_stato: z.string().trim().max(32).optional(),
  filtro_cliente: z.string().trim().max(200).optional(),
  filtro_destinazione_id: z.string().uuid().optional(),
});

function numeroConfig(valore: string | undefined, fallback: number): number {
  const numero = Number(valore);
  return Number.isFinite(numero) ? numero : fallback;
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user, ctx } = guard;

    const rl = checkRateLimit(`ai-search:${user.id}`, { limit: 30, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    const rawBody: unknown = await request.json().catch(() => null);
    const parsed = SearchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Payload invalido",
          dettagli: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        },
        { status: 400 }
      );
    }
    const { query, filtro_stato, filtro_cliente, filtro_destinazione_id } = parsed.data;

    const [queryEmbedding, config, scope] = await Promise.all([
      getCachedEmbedding(query),
      loadAiConfig(),
      getPreventivatoreScope(user.id, ctx.livello),
    ]);
    const matchThreshold = numeroConfig(config.soglia_similarity_simili, 0.5);
    const candidati = Math.trunc(numeroConfig(config.match_count_simili, 40));
    const matchCount = candidati > 0 ? Math.min(candidati, 200) : 40;

    // Tutti i filtri cliente finiscono DENTRO la RPC, prima della top-K: filtrare
    // dopo faceva sparire i risultati quando i primi candidati erano di altri clienti.
    let clienteIds: string[] | null = scope.restricted ? scope.clienteIds : null;
    const interseca = (ids: string[]) => (clienteIds ? ids.filter((id) => clienteIds!.includes(id)) : ids);
    let clienteTesto: string | null = null;
    if (filtro_destinazione_id) {
      // Secondo livello (sede/divisione), come nella lista classica.
      clienteIds = interseca([filtro_destinazione_id]);
    } else if (filtro_cliente) {
      // Stessa risoluzione della lista archivio: il filtro arriva come ragione
      // sociale del master, che con un ilike sul testo non intercetterebbe le
      // varianti storiche ("ALPHAMAC srl" non matcha "ALPHAMAC").
      const idsCliente = await idsMasterPerRagioneSociale(filtro_cliente);
      if (idsCliente.length > 0) clienteIds = interseca(idsCliente);
      else clienteTesto = filtro_cliente;
    }
    if (clienteIds?.length === 0) return NextResponse.json([]);

    const adminClient = createAdminClient();
    const { data: chunks, error: rpcError } = await adminClient
      .schema("preventivatore")
      .rpc("match_chunks_scoped", {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        p_cliente_ids: clienteIds,
        p_cliente: clienteTesto,
        p_tipo: null,
        p_escludi_documento: null,
      });

    if (rpcError) {
      logError("preventivatore.search", "RPC match_chunks_scoped error", rpcError);
      return NextResponse.json({ error: "Errore ricerca vettoriale" }, { status: 500 });
    }
    if (!chunks || chunks.length === 0) return NextResponse.json([]);

    type ChunkRow = { documento_id: string; similarity: number; contenuto: string };
    const righeChunk = chunks as ChunkRow[];
    const documentoIds = [...new Set(righeChunk.map((chunk) => chunk.documento_id))];

    let documentiQuery = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("id, codice, cliente, stato, categoria, numero_offerta, data_offerta")
      .in("id", documentoIds);
    if (filtro_stato && filtro_stato !== "tutti") {
      documentiQuery = documentiQuery.eq("stato", filtro_stato);
    }

    const { data: documenti, error: docError } = await documentiQuery;
    if (docError) {
      logError("preventivatore.search", "Documenti fetch error", docError);
      return NextResponse.json({ error: "Errore recupero documenti" }, { status: 500 });
    }

    const chunksByDoc = righeChunk.reduce<Record<string, ChunkRow[]>>((acc, chunk) => {
      if (!acc[chunk.documento_id]) acc[chunk.documento_id] = [];
      acc[chunk.documento_id].push(chunk);
      return acc;
    }, {});

    const risultati = (documenti ?? []).map((doc) => {
      const docChunks = chunksByDoc[doc.id] ?? [];
      const ordinati = [...docChunks].sort((a, b) => b.similarity - a.similarity);
      return {
        documento_id: doc.id,
        codice: doc.codice,
        cliente: doc.cliente,
        stato: doc.stato,
        categoria: doc.categoria,
        similarity: ordinati[0]?.similarity ?? 0,
        n_chunks: docChunks.length,
        top_chunk_contenuto: ordinati[0]?.contenuto ?? "",
        numero_offerta: doc.numero_offerta,
        data_offerta: doc.data_offerta,
      };
    });

    risultati.sort((a, b) => b.similarity - a.similarity);
    return NextResponse.json(risultati);
  } catch (error) {
    logError("preventivatore.search", "Search preventivatore error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
