import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedEmbedding } from "./embedding-cache";
import { loadAiConfig } from "./config-cache";
import type {
  DocumentoRow,
  ChunkRow,
  ChunkSearchRow,
  AggRow,
  TopArticoloRow,
  RigaDistintaRow,
  DettaglioRow,
  DettaglioRigaDistinta,
  ToolName,
} from "./types";

// ─── Tool: list_preventivi ────────────────────────────────────────────────────

export async function toolListPreventivi(args: {
  cliente?: string;
  stato?: string;
  categoria?: string;
  anno?: number;
  importo_min?: number;
  importo_max?: number;
  order_by?: string;
  order_dir?: string;
  limit?: number;
  count_only?: boolean;
}): Promise<DocumentoRow[] | { count: number; filters: Record<string, unknown> }> {
  const adminClient = createAdminClient();

  // Quando si vuole solo il conteggio (es. "quanti preventivi sopra X €"),
  // facciamo una query separata di count per evitare di restituire l'array.
  if (args.count_only) {
    let countQ = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("*", { count: "exact", head: true });
    if (args.cliente) countQ = countQ.ilike("cliente", `%${args.cliente}%`);
    if (args.stato && ["pending", "ordinato", "rifiutato"].includes(args.stato))
      countQ = countQ.eq("stato", args.stato);
    if (args.categoria) countQ = countQ.eq("categoria", args.categoria);
    if (args.anno) countQ = countQ.eq("anno", args.anno);
    if (typeof args.importo_min === "number") countQ = countQ.gte("importo_preventivo", args.importo_min);
    if (typeof args.importo_max === "number") countQ = countQ.lte("importo_preventivo", args.importo_max);
    const { count, error } = await countQ;
    if (error) {
      console.error("list_preventivi count error:", error);
      throw new Error("Errore conteggio preventivi");
    }
    return {
      count: count ?? 0,
      filters: {
        cliente: args.cliente ?? null,
        stato: args.stato ?? null,
        categoria: args.categoria ?? null,
        anno: args.anno ?? null,
        importo_min: args.importo_min ?? null,
        importo_max: args.importo_max ?? null,
      },
    };
  }

  let q = adminClient
    .schema("preventivatore")
    .from("documenti")
    .select(
      "codice, cliente, stato, categoria, numero_offerta, data_offerta, importo_preventivo, importo_ordinato, anno, tipo_prodotto"
    );

  if (args.cliente) q = q.ilike("cliente", `%${args.cliente}%`);
  if (args.stato && ["pending", "ordinato", "rifiutato"].includes(args.stato))
    q = q.eq("stato", args.stato);
  if (args.categoria) q = q.eq("categoria", args.categoria);
  if (args.anno) q = q.eq("anno", args.anno);
  if (typeof args.importo_min === "number") q = q.gte("importo_preventivo", args.importo_min);
  if (typeof args.importo_max === "number") q = q.lte("importo_preventivo", args.importo_max);

  const validOrderFields = ["codice", "importo_preventivo", "importo_ordinato", "data_offerta"];
  const orderField = validOrderFields.includes(args.order_by ?? "") ? args.order_by! : "codice";
  const ascending = args.order_dir === "asc";
  const rowLimit = Math.min(args.limit ?? 50, 200);

  const { data, error } = await q
    .order(orderField, { ascending, nullsFirst: false })
    .limit(rowLimit);

  if (error) {
    console.error("list_preventivi DB error:", error);
    throw new Error("Errore recupero preventivi dal database");
  }

  return (data ?? []) as DocumentoRow[];
}

// ─── Tool: cerca_simili ───────────────────────────────────────────────────────

/**
 * Ricerca semantica a livello di BLOCCO (non di documento).
 *
 * Ogni risultato è un singolo chunk-blocco di un preventivo storico, con il
 * riferimento al blocco (`blocco` = sheet_name/codice_blocco). Questo permette
 * di trovare un blocco molto simile anche se appartiene a un preventivo grande
 * e con importo totale molto diverso da quello in costruzione.
 *
 * Soglia e numero di candidati sono configurabili da `ai_config`
 * (`soglia_similarity_simili`, `match_count_simili`) — niente valori hard-coded.
 */
export async function toolCercaSimili(args: {
  query: string;
  cliente?: string;
  limite?: number;
}): Promise<
  Array<{
    documento_id: string;
    codice: string | null;
    cliente: string | null;
    stato: string | null;
    importo_preventivo: number | null;
    blocco: string | null;
    similarity: number;
    estratto: string;
  }>
> {
  const limite = args.limite ?? 8;
  const adminClient = createAdminClient();

  // Parametri configurabili (con fallback prudenti)
  const cfg = await loadAiConfig();
  const matchThreshold = Math.max(0, Math.min(1, parseFloat(cfg.soglia_similarity_simili ?? "0.5") || 0.5));
  const matchCount = Math.max(limite, parseInt(cfg.match_count_simili ?? "40", 10) || 40);

  const queryEmbedding = await getCachedEmbedding(args.query);

  const { data: chunks, error: rpcError } = await adminClient
    .schema("preventivatore")
    .rpc("match_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

  if (rpcError) {
    console.error("match_chunks RPC error:", rpcError);
    throw new Error("Errore ricerca vettoriale");
  }

  const typedChunks = (chunks ?? []) as ChunkRow[];
  if (typedChunks.length === 0) return [];

  // Metadati dei documenti coinvolti (codice, cliente, stato, importo)
  const docIds = [...new Set(typedChunks.map((c) => c.documento_id))];
  let docsQuery = adminClient
    .schema("preventivatore")
    .from("documenti")
    .select("id, codice, cliente, stato, importo_preventivo, data_offerta, data_consegna_richiesta, data_consegna_confermata, data_consegna_effettiva, giorni_consegna_offerti, numero_offerta, numero_preventivo, tipo_cartella")
    .in("id", docIds);
  if (args.cliente) docsQuery = docsQuery.ilike("cliente", `%${args.cliente}%`);

  const { data: documenti, error: docError } = await docsQuery;
  if (docError) {
    console.error("Documenti fetch error:", docError);
    throw new Error("Errore recupero metadati documenti");
  }
  const docMap = new Map(
    (documenti ?? []).map((d: { id: string; codice: string | null; cliente: string | null; stato: string | null; importo_preventivo: number | null }) => [d.id, d])
  );

  // Un risultato per chunk-blocco (NO deduplica per documento): un preventivo
  // grande può comparire con più blocchi diversi, ognuno col suo punteggio.
  return typedChunks
    .filter((c) => docMap.has(c.documento_id))
    .map((c) => {
      const doc = docMap.get(c.documento_id)!;
      const meta = c.metadata ?? {};
      const blocco =
        (typeof meta.sheet_name === "string" && meta.sheet_name.trim()) ||
        (typeof meta.codice_blocco === "string" && meta.codice_blocco.trim()) ||
        null;
      return {
        documento_id: doc.id,
        codice: doc.codice,
        cliente: doc.cliente,
        stato: doc.stato,
        importo_preventivo: doc.importo_preventivo,
        blocco,
        similarity: c.similarity,
        estratto: c.contenuto.slice(0, 300),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limite);
}

// ─── Tool: cerca_articolo ─────────────────────────────────────────────────────

export async function toolCercaArticolo(args: {
  query: string;
  codice_preventivo?: string;
  limite?: number;
}): Promise<Array<{ documento_id: string; codice: string | null; cliente: string | null; estratto: string }>> {
  const limite = Math.min(args.limite ?? 10, 20);
  const adminClient = createAdminClient();

  let q = adminClient
    .schema("preventivatore")
    .from("chunks")
    .select("documento_id, contenuto, metadata")
    .ilike("contenuto", `%${args.query}%`);

  if (args.codice_preventivo)
    q = q.eq("metadata->>codice_progetto", args.codice_preventivo);

  const { data, error } = await q.limit(limite * 3);

  if (error) {
    console.error("cerca_articolo error:", error);
    throw new Error("Errore ricerca testo nei preventivi");
  }

  const seen = new Set<string>();
  const risultati: Array<{ documento_id: string; codice: string | null; cliente: string | null; estratto: string }> = [];

  for (const chunk of (data ?? []) as ChunkSearchRow[]) {
    const docId = chunk.documento_id;
    if (seen.has(docId)) continue;
    seen.add(docId);

    const lines = chunk.contenuto.split("\n");
    const queryLower = args.query.toLowerCase();
    const matchLines = lines.filter(l => l.toLowerCase().includes(queryLower));
    const estratto = (matchLines.length > 0 ? matchLines.slice(0, 4).join("\n") : lines.slice(0, 3).join("\n")).slice(0, 400);

    risultati.push({
      documento_id: docId,
      codice: (chunk.metadata?.codice_progetto as string) ?? null,
      cliente: (chunk.metadata?.cliente as string) ?? null,
      estratto,
    });

    if (risultati.length >= limite) break;
  }

  return risultati;
}

// ─── Tool: query_righe_distinta ───────────────────────────────────────────────

export async function toolQueryRigheDistinta(args: {
  modalita: "max_prezzo" | "top_costi" | "cerca_codice" | "cerca_descrizione";
  query?: string;
  categoria?: string;
  filtro_cliente?: string;
  filtro_stato?: string;
  limit?: number;
}): Promise<RigaDistintaRow[]> {
  const adminClient = createAdminClient();
  const limit = Math.min(args.limit ?? 10, 50);

  let docQ = adminClient.schema("preventivatore").from("documenti").select("id, codice, cliente");
  if (args.categoria)       docQ = docQ.eq("categoria", args.categoria);
  if (args.filtro_cliente)  docQ = docQ.ilike("cliente", `%${args.filtro_cliente}%`);
  if (args.filtro_stato && ["pending","ordinato","rifiutato"].includes(args.filtro_stato))
    docQ = docQ.eq("stato", args.filtro_stato);

  const { data: docs, error: docErr } = await docQ.limit(2000);
  if (docErr || !docs || docs.length === 0) return [];

  const docMap = new Map(
    (docs as Array<{ id: string; codice: string; cliente: string | null }>).map(d => [d.id, d])
  );
  const docIds = Array.from(docMap.keys());

  let q = adminClient
    .schema("preventivatore")
    .from("righe_distinta")
    .select("codice_articolo, descrizione, prezzo_unitario, quantita, totale_riga, documento_id")
    .in("documento_id", docIds)
    .not("prezzo_unitario", "is", null);

  if (args.modalita === "cerca_codice" && args.query) {
    q = q.ilike("codice_articolo", `%${args.query}%`);
  } else if (args.modalita === "cerca_descrizione" && args.query) {
    q = q.ilike("descrizione", `%${args.query}%`);
  }

  if (args.modalita === "max_prezzo" || args.modalita === "top_costi") {
    q = q.order("prezzo_unitario", { ascending: false, nullsFirst: false });
  }

  const { data: righe, error: righeErr } = await q.limit(limit * 5);
  if (righeErr || !righe) return [];

  type RigaRaw = {
    codice_articolo: string | null;
    descrizione: string;
    prezzo_unitario: number | null;
    quantita: number | null;
    totale_riga: number | null;
    documento_id: string;
  };

  if (args.modalita === "top_costi") {
    const byCode = new Map<string, RigaDistintaRow>();
    for (const r of righe as RigaRaw[]) {
      const key = r.codice_articolo ?? r.descrizione.slice(0, 40);
      const doc = docMap.get(r.documento_id);
      if (!byCode.has(key) || (r.prezzo_unitario ?? 0) > (byCode.get(key)!.prezzo_unitario ?? 0)) {
        byCode.set(key, {
          codice_articolo: r.codice_articolo,
          descrizione: r.descrizione,
          prezzo_unitario: r.prezzo_unitario,
          quantita: r.quantita,
          totale_riga: r.totale_riga,
          codice_preventivo: doc?.codice ?? null,
          cliente: doc?.cliente ?? null,
          n_utilizzi: (byCode.get(key)?.n_utilizzi ?? 0) + 1,
        });
      } else {
        const existing = byCode.get(key)!;
        existing.n_utilizzi++;
      }
    }
    return Array.from(byCode.values())
      .sort((a, b) => (b.prezzo_unitario ?? 0) - (a.prezzo_unitario ?? 0))
      .slice(0, limit);
  }

  return (righe as RigaRaw[]).slice(0, limit).map(r => {
    const doc = docMap.get(r.documento_id);
    return {
      codice_articolo: r.codice_articolo,
      descrizione: r.descrizione,
      prezzo_unitario: r.prezzo_unitario,
      quantita: r.quantita,
      totale_riga: r.totale_riga,
      codice_preventivo: doc?.codice ?? null,
      cliente: doc?.cliente ?? null,
      n_utilizzi: 1,
    };
  });
}

// ─── Tool: top_articoli ───────────────────────────────────────────────────────

export async function toolTopArticoli(args: {
  categoria?: string;
  top_n?: number;
  filtro_cliente?: string;
  filtro_stato?: string;
}): Promise<TopArticoloRow[]> {
  const adminClient = createAdminClient();
  const topN = Math.min(args.top_n ?? 10, 30);

  let docQ = adminClient
    .schema("preventivatore")
    .from("documenti")
    .select("id");
  if (args.categoria) docQ = docQ.eq("categoria", args.categoria);
  if (args.filtro_cliente) docQ = docQ.ilike("cliente", `%${args.filtro_cliente}%`);
  if (args.filtro_stato && ["pending", "ordinato", "rifiutato"].includes(args.filtro_stato))
    docQ = docQ.eq("stato", args.filtro_stato);

  const { data: docs, error: docErr } = await docQ.limit(1000);
  if (docErr || !docs || docs.length === 0) return [];

  const docIds = docs.map((d: { id: string }) => d.id);

  const { data: chunks, error: chunkErr } = await adminClient
    .schema("preventivatore")
    .from("chunks")
    .select("documento_id, contenuto")
    .in("documento_id", docIds);

  if (chunkErr || !chunks) return [];

  const CODE_REGEX =
    /(?<![./\w])(\d{5,9})(?![\d./])|([A-Z]{2,}(?:\.[A-Z0-9]+){2,})(?![A-Z0-9.])/g;

  const articleMap = new Map<string, { docIds: Set<string>; descrizione: string }>();

  for (const chunk of chunks as Array<{ documento_id: string; contenuto: string }>) {
    const docId = chunk.documento_id;
    const lines = chunk.contenuto.split("\n");

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.length < 4) continue;
      if (/^(TOTALE|PREZZO|OFFERTA|CLIENTE|DATA|NOTE|OGGETTO|PROGETTO|\s*[-=]{3,})/i.test(line)) continue;

      CODE_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CODE_REGEX.exec(line)) !== null) {
        const codice = (match[1] ?? match[2]).trim();
        if (!codice) continue;

        const afterCode = line.slice((match.index ?? 0) + codice.length).replace(/^[\s|:;,]+/, "").slice(0, 60).trim();
        const descrizione = afterCode || line.slice(0, 60).trim();

        if (!articleMap.has(codice)) {
          articleMap.set(codice, { docIds: new Set(), descrizione });
        }
        articleMap.get(codice)!.docIds.add(docId);
        const cur = articleMap.get(codice)!;
        if (descrizione.length > cur.descrizione.length) cur.descrizione = descrizione;
      }
    }
  }

  return Array.from(articleMap.entries())
    .map(([codice, v]) => ({
      codice,
      n_preventivi: v.docIds.size,
      esempio_descrizione: v.descrizione.slice(0, 80),
    }))
    .filter((r) => r.n_preventivi >= 2)
    .sort((a, b) => b.n_preventivi - a.n_preventivi)
    .slice(0, topN);
}

// ─── Tool: aggrega_preventivi ─────────────────────────────────────────────────

export async function toolAggregatPreventivi(args: {
  group_by: "stato" | "cliente" | "categoria" | "anno" | "mese";
  metrica?: "count" | "sum_importo" | "avg_importo" | "tasso_ordinato";
  filtro_stato?: string;
  filtro_cliente?: string;
  filtro_anno?: number;
  filtro_importo_min?: number;
  filtro_importo_max?: number;
  limit?: number;
}): Promise<AggRow[]> {
  const adminClient = createAdminClient();

  let q = adminClient
    .schema("preventivatore")
    .from("documenti")
    .select("stato, cliente, categoria, importo_preventivo, importo_ordinato, data_offerta, codice, anno, numero_offerta");

  if (args.filtro_stato && ["pending", "ordinato", "rifiutato"].includes(args.filtro_stato))
    q = q.eq("stato", args.filtro_stato);
  if (args.filtro_cliente)
    q = q.ilike("cliente", `%${args.filtro_cliente}%`);
  if (args.filtro_anno) {
    q = q.eq("anno", args.filtro_anno);
  }
  if (typeof args.filtro_importo_min === "number") q = q.gte("importo_preventivo", args.filtro_importo_min);
  if (typeof args.filtro_importo_max === "number") q = q.lte("importo_preventivo", args.filtro_importo_max);

  const { data, error } = await q.limit(2000);
  if (error) {
    console.error("aggrega_preventivi error:", error);
    throw new Error("Errore aggregazione dati");
  }

  const rows = (data ?? []) as DocumentoRow[];
  const groupMap = new Map<string, { count: number; sumImp: number; sumOrd: number; cntOrd: number }>();

  for (const row of rows) {
    let key: string;
    const gb = args.group_by;

    if (gb === "stato") {
      key = row.stato ?? "N/D";
    } else if (gb === "cliente") {
      key = row.cliente ?? "N/D";
    } else if (gb === "categoria") {
      key = row.categoria ?? "N/D";
    } else if (gb === "anno") {
      // Preferenza: colonna anno (popolata da V2). Fallback: data_offerta o codice.
      const annoCol = (row as DocumentoRow & { anno?: number | null }).anno;
      if (annoCol != null) {
        key = String(annoCol);
      } else if (row.data_offerta) {
        key = new Date(row.data_offerta).getFullYear().toString();
      } else {
        const m = row.codice?.match(/_(\d{2})_/);
        key = m ? `20${m[1]}` : "N/D";
      }
    } else {
      if (row.data_offerta) {
        key = new Date(row.data_offerta).toISOString().slice(0, 7);
      } else {
        key = "N/D";
      }
    }

    const existing = groupMap.get(key) ?? { count: 0, sumImp: 0, sumOrd: 0, cntOrd: 0 };
    existing.count++;
    existing.sumImp += row.importo_preventivo ?? 0;
    existing.sumOrd += row.importo_ordinato ?? 0;
    if (row.stato === "ordinato") existing.cntOrd++;
    groupMap.set(key, existing);
  }

  const metrica = args.metrica ?? "count";
  const limit = Math.min(args.limit ?? 20, 50);

  return Array.from(groupMap.entries())
    .map(([gruppo, v]) => ({
      gruppo,
      count: v.count,
      sum_importo: Math.round(v.sumImp),
      avg_importo: v.count > 0 ? Math.round(v.sumImp / v.count) : 0,
      tasso_ordinato: v.count > 0 ? Math.round((v.cntOrd / v.count) * 100) : 0,
    }))
    .sort((a, b) => {
      if (metrica === "sum_importo") return b.sum_importo - a.sum_importo;
      if (metrica === "avg_importo") return b.avg_importo - a.avg_importo;
      if (metrica === "tasso_ordinato") return b.tasso_ordinato - a.tasso_ordinato;
      return b.count - a.count;
    })
    .slice(0, limit);
}

// ─── Tool: dettaglio_preventivo ───────────────────────────────────────────────

export async function toolDettaglioPreventivo(args: { codice: string }): Promise<DettaglioRow | null> {
  const adminClient = createAdminClient();

  const raw = args.codice.trim().toUpperCase();
  const withUnderscore = raw.replace(/\//g, "_");
  const withSlash = raw.replace(/_/g, "/");

  const { data: docs, error: docErr } = await adminClient
    .schema("preventivatore")
    .from("documenti")
    .select("id, codice, cliente, stato, categoria, importo_preventivo, importo_ordinato, importo_offerta, data_offerta, data_consegna_richiesta, data_consegna_confermata, data_consegna_effettiva, giorni_consegna_offerti, numero_offerta, numero_preventivo, tipo_cartella, tipo")
    .or(`codice.ilike.${withUnderscore},codice.ilike.${withSlash}`)
    .limit(1);

  if (docErr) { console.error("dettaglio_preventivo doc error:", docErr); return null; }
  if (!docs || docs.length === 0) return null;

  type DocRow = { id: string; codice: string; cliente: string | null; stato: string | null; categoria: string | null; importo_preventivo: number | null; importo_ordinato: number | null; data_offerta: string | null };
  const doc = docs[0] as DocRow;

  const { data: chunks, error: chunkErr } = await adminClient
    .schema("preventivatore")
    .from("chunks")
    .select("contenuto")
    .eq("documento_id", doc.id)
    .order("created_at", { ascending: true });

  if (chunkErr) { console.error("dettaglio_preventivo chunk error:", chunkErr); throw new Error("Errore recupero testo preventivo"); }

  const testo_completo = (chunks ?? []).map((c: { contenuto: string }) => c.contenuto).join("\n\n---\n\n");

  const { data: righe } = await adminClient
    .schema("preventivatore")
    .from("righe_distinta")
    .select("sheet_name, codice_articolo, descrizione, quantita, prezzo_unitario, ricarico_pct, totale_riga")
    .eq("documento_id", doc.id)
    .order("created_at", { ascending: true });

  return {
    documento: {
      codice: doc.codice,
      cliente: doc.cliente,
      stato: doc.stato,
      categoria: doc.categoria,
      importo_preventivo: doc.importo_preventivo,
      importo_ordinato: doc.importo_ordinato,
      data_offerta: doc.data_offerta,
    },
    testo_completo,
    righe_distinta: (righe ?? []) as DettaglioRigaDistinta[],
    n_chunks: (chunks ?? []).length,
  };
}

// ─── Tool: analisi_preventivi_sql ───────────────────────────────────────────

export async function toolAnalisiPreventiviSql(args: {
  modalita:
    | "statistiche_categoria"
    | "statistiche_cliente"
    | "statistiche_tipo_prodotto"
    | "confronta_anni"
    | "top_codici_valore"
    | "top_codici_frequenza"
    | "analisi_ricarichi"
    | "analisi_lavorazioni"
    | "controllo_qualita"
    | "preventivi_da_completare";
  anno?: number;
  anno_a?: number;
  anno_b?: number;
  stato?: string;
  cliente?: string;
  categoria?: string;
  tipo_prodotto?: string;
  group_by?: string;
  limit?: number;
}): Promise<unknown[]> {
  const adminClient = createAdminClient().schema("preventivatore");
  const limit = typeof args.limit === "number" ? args.limit : undefined;

  const runRpc = async (fn: string, params: Record<string, unknown>) => {
    const { data, error } = await adminClient.rpc(fn, params);
    if (error) {
      console.error(`${fn} RPC error:`, error);
      throw new Error(`Errore analisi SQL: ${fn}`);
    }
    return (data ?? []) as unknown[];
  };

  if (args.modalita === "statistiche_categoria") {
    return runRpc("ai_statistiche_per_categoria", {
      p_anno: args.anno ?? null,
      p_stato: args.stato ?? null,
      p_cliente: args.cliente ?? null,
    });
  }

  if (args.modalita === "statistiche_cliente") {
    return runRpc("ai_statistiche_per_cliente", {
      p_anno: args.anno ?? null,
      p_stato: args.stato ?? null,
      p_categoria: args.categoria ?? null,
      p_limit: limit ?? 50,
    });
  }

  if (args.modalita === "statistiche_tipo_prodotto") {
    return runRpc("ai_statistiche_per_tipo_prodotto", {
      p_anno: args.anno ?? null,
      p_stato: args.stato ?? null,
      p_categoria: args.categoria ?? null,
    });
  }

  if (args.modalita === "confronta_anni") {
    if (!args.anno_a || !args.anno_b) throw new Error("confronta_anni richiede anno_a e anno_b");
    return runRpc("ai_confronta_anni", {
      p_anno_a: args.anno_a,
      p_anno_b: args.anno_b,
      p_categoria: args.categoria ?? null,
      p_tipo_prodotto: args.tipo_prodotto ?? null,
    });
  }

  if (args.modalita === "top_codici_valore") {
    return runRpc("ai_top_codici_per_valore", {
      p_anno: args.anno ?? null,
      p_categoria: args.categoria ?? null,
      p_cliente: args.cliente ?? null,
      p_limit: limit ?? 20,
    });
  }

  if (args.modalita === "top_codici_frequenza") {
    return runRpc("ai_top_codici_per_frequenza", {
      p_anno: args.anno ?? null,
      p_categoria: args.categoria ?? null,
      p_cliente: args.cliente ?? null,
      p_limit: limit ?? 20,
    });
  }

  if (args.modalita === "analisi_ricarichi") {
    return runRpc("ai_analisi_ricarichi", {
      p_group_by: args.group_by ?? "categoria",
      p_anno: args.anno ?? null,
      p_categoria: args.categoria ?? null,
      p_cliente: args.cliente ?? null,
      p_limit: limit ?? 50,
    });
  }

  if (args.modalita === "analisi_lavorazioni") {
    return runRpc("ai_analisi_lavorazioni_ore_tariffe", {
      p_anno: args.anno ?? null,
      p_categoria: args.categoria ?? null,
      p_tipo_prodotto: args.tipo_prodotto ?? null,
      p_cliente: args.cliente ?? null,
    });
  }

  if (args.modalita === "controllo_qualita") {
    return runRpc("ai_controllo_qualita_dati", { p_anno: args.anno ?? null });
  }

  if (args.modalita === "preventivi_da_completare") {
    return runRpc("ai_preventivi_da_completare", {
      p_anno: args.anno ?? null,
      p_limit: limit ?? 100,
    });
  }

  throw new Error(`Modalita analisi SQL sconosciuta: ${args.modalita}`);
}

// ─── Tool: cerca_anomalie_importi ─────────────────────────────────────────────

export async function toolCercaAnomalieImporti(args: {
  classificazione?: "molto_alto" | "alto" | "molto_basso" | "basso";
  cliente?: string;
  categoria?: string;
  anno?: number;
  limit?: number;
}): Promise<Array<{
  codice: string; cliente: string | null; categoria: string | null;
  importo: number; media: number; sigma: number; z_score: number;
  classificazione: string; n_storico: number;
}>> {
  const adminClient = createAdminClient();
  let q = adminClient
    .schema("preventivatore")
    .from("v_anomalie_importi")
    .select("codice, cliente, categoria, importo_preventivo, media, sigma, z_score, classificazione, n_storico");

  if (args.classificazione) {
    q = q.eq("classificazione", args.classificazione);
  } else {
    // Default: solo anomalie reali (z > 1)
    q = q.in("classificazione", ["molto_alto", "alto", "molto_basso", "basso"]);
  }
  if (args.cliente) q = q.ilike("cliente", `%${args.cliente}%`);
  if (args.categoria) q = q.eq("categoria", args.categoria);
  if (args.anno) q = q.eq("anno", args.anno);

  const limit = Math.min(args.limit ?? 20, 100);
  const { data, error } = await q.order("z_score", { ascending: false }).limit(limit);
  if (error) {
    console.error("cerca_anomalie error:", error);
    throw new Error("Errore ricerca anomalie");
  }

  type Row = {
    codice: string; cliente: string | null; categoria: string | null;
    importo_preventivo: number; media: number; sigma: number;
    z_score: number; classificazione: string; n_storico: number;
  };
  return (data ?? []).map((r: Row) => ({
    codice: r.codice,
    cliente: r.cliente,
    categoria: r.categoria,
    importo: r.importo_preventivo,
    media: r.media,
    sigma: r.sigma,
    z_score: r.z_score,
    classificazione: r.classificazione,
    n_storico: r.n_storico,
  }));
}

// ─── Tool dispatch ────────────────────────────────────────────────────────────

export async function dispatchTool(name: string, args: Record<string, unknown>) {
  if (name === "list_preventivi")        return toolListPreventivi(args as Parameters<typeof toolListPreventivi>[0]);
  if (name === "cerca_simili")           return toolCercaSimili(args as Parameters<typeof toolCercaSimili>[0]);
  if (name === "cerca_articolo")         return toolCercaArticolo(args as Parameters<typeof toolCercaArticolo>[0]);
  if (name === "aggrega_preventivi")     return toolAggregatPreventivi(args as Parameters<typeof toolAggregatPreventivi>[0]);
  if (name === "top_articoli")           return toolTopArticoli(args as Parameters<typeof toolTopArticoli>[0]);
  if (name === "query_righe_distinta")   return toolQueryRigheDistinta(args as Parameters<typeof toolQueryRigheDistinta>[0]);
  if (name === "dettaglio_preventivo")   return toolDettaglioPreventivo(args as Parameters<typeof toolDettaglioPreventivo>[0]);
  if (name === "analisi_preventivi_sql") return toolAnalisiPreventiviSql(args as Parameters<typeof toolAnalisiPreventiviSql>[0]);
  if (name === "cerca_anomalie_importi") return toolCercaAnomalieImporti(args as Parameters<typeof toolCercaAnomalieImporti>[0]);
  throw new Error(`Tool sconosciuto: ${name}`);
}
