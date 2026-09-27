import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedEmbedding } from "./embedding-cache";
import { loadAiConfig } from "./config-cache";
import { isStatoDocumento } from "@/lib/portali/preventivatore/stati";
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

// Scope commerciale: normalizza i cliente_master_id visibili (lista vuota → UUID
// impossibile, così il commerciale ristretto senza clienti vede 0 record).
function scopeIds(ids: string[] | null | undefined): string[] | null {
  if (!Array.isArray(ids)) return null;
  return ids;
}

// ─── Codici preventivo: separatore tollerante ────────────────────────────────
// Gli utenti scrivono indifferentemente `C/25/25`, `C_25_25` o `c 25 25`, mentre in
// DB il codice è salvato con underscore. Queste helper generano le varianti da
// cercare, così ogni tool che accetta un codice trova il documento.

// Escape dei metacaratteri PostgREST/ILIKE: definizione unica in `postgrest.ts`,
// importata (e ri-esportata) qui perché i test e i tool la usano da questo modulo.
import { escapeIlike } from "@/lib/portali/preventivatore/postgrest";
export { escapeIlike };

/** Varianti `_` e `/` del codice, normalizzate in maiuscolo. */
export function variantiCodice(codice: string): { conUnderscore: string; conSlash: string } {
  const raw = codice.trim().toUpperCase().replace(/\s+/g, "_");
  return {
    conUnderscore: raw.replace(/[/\-.]/g, "_"),
    conSlash: raw.replace(/[_\-.]/g, "/"),
  };
}

/** Filtro `.or()` PostgREST che matcha il codice in entrambe le notazioni. */
function filtroCodiceOr(campo: string, codice: string, parziale = false): string {
  const { conUnderscore, conSlash } = variantiCodice(codice);
  // Anche il codice così com'è scritto: i codici commessa del builder possono
  // contenere `-` o `.` (es. `SIM-RIC-0927`), che le due varianti trasformano.
  const esatto = codice.trim().toUpperCase().replace(/\s+/g, "_");
  const wrap = (s: string) => (parziale ? `%${escapeIlike(s)}%` : escapeIlike(s));
  return [...new Set([esatto, conUnderscore, conSlash])].map((v) => `${campo}.ilike.${wrap(v)}`).join(",");
}

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
}, clienteIds: string[] | null = null): Promise<DocumentoRow[] | { count: number; filters: Record<string, unknown> }> {
  const adminClient = createAdminClient();
  const scope = scopeIds(clienteIds);

  // Quando si vuole solo il conteggio (es. "quanti preventivi sopra X €"),
  // facciamo una query separata di count per evitare di restituire l'array.
  if (args.count_only) {
    let countQ = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("*", { count: "exact", head: true });
    if (scope) countQ = countQ.in("cliente_master_id", scope);
    if (args.cliente) countQ = countQ.ilike("cliente", `%${args.cliente}%`);
    if (args.stato && isStatoDocumento(args.stato))
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
      "codice, cliente, stato, categoria, numero_offerta, data_offerta, importo_preventivo, importo_ordinato, anno, tipo_prodotto, data_consegna_richiesta, data_consegna_confermata, data_consegna_effettiva, giorni_consegna_offerti"
    );

  if (scope) q = q.in("cliente_master_id", scope);
  if (args.cliente) q = q.ilike("cliente", `%${args.cliente}%`);
  if (args.stato && isStatoDocumento(args.stato))
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
  tipo?: "storico" | "generato";
  limite?: number;
}, clienteIds: string[] | null = null): Promise<
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
    .rpc("match_chunks_scoped", {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
      p_cliente_ids: clienteIds,
      p_cliente: args.cliente ?? null,
      p_tipo: args.tipo ?? null,
      p_escludi_documento: null,
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

// ─── Lettura a pagine e filtri per documento ─────────────────────────────────
// PostgREST restituisce al massimo 1.000 righe per richiesta: senza paginazione un
// aggregato si calcola su un sottoinsieme arbitrario, in silenzio. E una lista di
// id dentro `.in()` finisce nell'URL: con centinaia di documenti supera il limite
// di nginx (8 KB) e la richiesta fallisce. Da qui le due helper.

const PAGINA = 1_000;
const TETTO_RIGHE = 20_000;
const LOTTO_ID = 150;

type RispostaPagina = { data: unknown[] | null; error: { message: string } | null };

/** Legge tutte le pagine (ordine deterministico a cura del chiamante) fino al tetto. */
async function tutteLePagine<T>(
  pagina: (da: number, a: number) => PromiseLike<RispostaPagina>,
  tetto = TETTO_RIGHE
): Promise<{ righe: T[]; incompleto: boolean }> {
  const righe: T[] = [];
  for (let da = 0; da < tetto; da += PAGINA) {
    const { data, error } = await pagina(da, da + PAGINA - 1);
    if (error) throw new Error(error.message);
    const blocco = (data ?? []) as T[];
    righe.push(...blocco);
    if (blocco.length < PAGINA) return { righe, incompleto: false };
  }
  return { righe, incompleto: true };
}

/** Esegue la query su lotti di id (per stare sotto il limite dell'URL) e unisce. */
async function perLotti<T>(ids: string[], query: (lotto: string[]) => PromiseLike<RispostaPagina>): Promise<T[]> {
  const risultati: T[] = [];
  for (let i = 0; i < ids.length; i += LOTTO_ID) {
    const { data, error } = await query(ids.slice(i, i + LOTTO_ID));
    if (error) throw new Error(error.message);
    risultati.push(...((data ?? []) as T[]));
  }
  return risultati;
}

type DocumentoMinimo = { id: string; codice: string | null; cliente: string | null };

/**
 * Documenti che rispettano scope e filtri. `null` = nessun filtro attivo: il
 * chiamante interroga le righe direttamente, senza liste di id.
 */
async function documentiFiltrati(filtri: {
  scope: string[] | null;
  categoria?: string;
  cliente?: string;
  stato?: string;
  codice?: string;
}): Promise<DocumentoMinimo[] | null> {
  const stato = filtri.stato && isStatoDocumento(filtri.stato) ? filtri.stato : undefined;
  if (!filtri.scope && !filtri.categoria && !filtri.cliente && !stato && !filtri.codice) return null;
  if (filtri.scope && filtri.scope.length === 0) return [];
  const adminClient = createAdminClient();
  const { righe } = await tutteLePagine<DocumentoMinimo>((da, a) => {
    let q = adminClient.schema("preventivatore").from("documenti").select("id, codice, cliente");
    if (filtri.scope) q = q.in("cliente_master_id", filtri.scope);
    if (filtri.categoria) q = q.eq("categoria", filtri.categoria);
    if (filtri.cliente) q = q.ilike("cliente", `%${escapeIlike(filtri.cliente)}%`);
    if (stato) q = q.eq("stato", stato);
    if (filtri.codice) q = q.or(filtroCodiceOr("codice", filtri.codice));
    return q.order("id", { ascending: true }).range(da, a);
  });
  return righe;
}

/** Codice e cliente dei documenti citati nei risultati (pochi id, a lotti). */
async function mappaDocumenti(ids: string[]): Promise<Map<string, DocumentoMinimo>> {
  const adminClient = createAdminClient();
  const unici = [...new Set(ids)];
  const righe = await perLotti<DocumentoMinimo>(unici, (lotto) =>
    adminClient.schema("preventivatore").from("documenti").select("id, codice, cliente").in("id", lotto));
  return new Map(righe.map((d) => [d.id, d]));
}

// ─── Tool: cerca_articolo ─────────────────────────────────────────────────────
// Cerca sia nelle righe strutturate (codice/descrizione: trova anche i preventivi
// del builder) sia nel testo dei documenti storici.

export async function toolCercaArticolo(args: {
  query: string;
  codice_preventivo?: string;
  limite?: number;
}, clienteIds: string[] | null = null): Promise<Array<{ documento_id: string; codice: string | null; cliente: string | null; estratto: string }>> {
  const limite = Math.min(args.limite ?? 10, 20);
  const adminClient = createAdminClient();
  const documenti = await documentiFiltrati({ scope: scopeIds(clienteIds), codice: args.codice_preventivo });
  if (documenti && documenti.length === 0) return [];

  const escaped = escapeIlike(args.query.trim());
  const cercaRighe = (lotto: string[] | null) => {
    let q = adminClient.schema("preventivatore").from("righe_distinta")
      .select("documento_id, codice_articolo, descrizione")
      .or(`codice_articolo.ilike.%${escaped}%,descrizione.ilike.%${escaped}%`);
    if (lotto) q = q.in("documento_id", lotto);
    // I più recenti prima: un codice comune compare in decine di preventivi, e
    // chi chiede quasi sempre cerca il lavoro recente.
    return q.order("created_at", { ascending: false }).order("id", { ascending: true }).limit(limite * 3);
  };
  const cercaChunk = (lotto: string[] | null) => {
    let q = adminClient.schema("preventivatore").from("chunks")
      .select("documento_id, contenuto, metadata")
      .ilike("contenuto", `%${escaped}%`);
    if (lotto) q = q.in("documento_id", lotto);
    // I più recenti prima: un codice comune compare in decine di preventivi, e
    // chi chiede quasi sempre cerca il lavoro recente.
    return q.order("created_at", { ascending: false }).order("id", { ascending: true }).limit(limite * 3);
  };

  type RigaTrovata = { documento_id: string; codice_articolo: string | null; descrizione: string };
  let righe: RigaTrovata[];
  let chunks: ChunkSearchRow[];
  if (documenti) {
    const ids = documenti.map((d) => d.id);
    [righe, chunks] = await Promise.all([perLotti<RigaTrovata>(ids, cercaRighe), perLotti<ChunkSearchRow>(ids, cercaChunk)]);
  } else {
    const [r, c] = await Promise.all([cercaRighe(null), cercaChunk(null)]);
    if (r.error || c.error) throw new Error("Errore ricerca testo nei preventivi");
    righe = (r.data ?? []) as RigaTrovata[];
    chunks = (c.data ?? []) as ChunkSearchRow[];
  }

  const docMap = documenti
    ? new Map(documenti.map((d) => [d.id, d]))
    : await mappaDocumenti([...righe.map((r) => r.documento_id), ...chunks.map((c) => c.documento_id)]);
  const queryMinuscola = args.query.toLowerCase();
  const risultati = new Map<string, { documento_id: string; codice: string | null; cliente: string | null; estratto: string }>();
  for (const riga of righe) {
    if (risultati.has(riga.documento_id)) continue;
    const documento = docMap.get(riga.documento_id);
    risultati.set(riga.documento_id, {
      documento_id: riga.documento_id,
      codice: documento?.codice ?? null,
      cliente: documento?.cliente ?? null,
      estratto: `${riga.codice_articolo ?? ""} ${riga.descrizione}`.trim().slice(0, 400),
    });
  }
  for (const chunk of chunks) {
    if (risultati.has(chunk.documento_id)) continue;
    const documento = docMap.get(chunk.documento_id);
    const linee = chunk.contenuto.split("\n");
    const pertinenti = linee.filter((linea) => linea.toLowerCase().includes(queryMinuscola));
    risultati.set(chunk.documento_id, {
      documento_id: chunk.documento_id,
      codice: documento?.codice ?? (typeof chunk.metadata?.codice_progetto === "string" ? chunk.metadata.codice_progetto : null),
      cliente: documento?.cliente ?? (typeof chunk.metadata?.cliente === "string" ? chunk.metadata.cliente : null),
      estratto: (pertinenti.length ? pertinenti.slice(0, 4) : linee.slice(0, 3)).join("\n").slice(0, 400),
    });
  }
  return [...risultati.values()].slice(0, limite);
}

// ─── Tool: query_righe_distinta ───────────────────────────────────────────────

export async function toolQueryRigheDistinta(args: {
  modalita: "max_prezzo" | "top_costi" | "cerca_codice" | "cerca_descrizione";
  query?: string;
  categoria?: string;
  filtro_cliente?: string;
  filtro_stato?: string;
  limit?: number;
}, clienteIds: string[] | null = null): Promise<RigaDistintaRow[]> {
  const adminClient = createAdminClient();
  const limit = Math.min(args.limit ?? 10, 50);
  const documenti = await documentiFiltrati({
    scope: scopeIds(clienteIds), categoria: args.categoria, cliente: args.filtro_cliente, stato: args.filtro_stato,
  });
  if (documenti && documenti.length === 0) return [];

  type RigaRaw = {
    codice_articolo: string | null;
    descrizione: string;
    prezzo_unitario: number | null;
    quantita: number | null;
    totale_riga: number | null;
    documento_id: string;
  };
  const perPrezzo = args.modalita === "max_prezzo" || args.modalita === "top_costi";
  const cerca = (lotto: string[] | null) => {
    let q = adminClient
      .schema("preventivatore")
      .from("righe_distinta")
      .select("codice_articolo, descrizione, prezzo_unitario, quantita, totale_riga, documento_id")
      .not("prezzo_unitario", "is", null);
    if (lotto) q = q.in("documento_id", lotto);
    if (args.modalita === "cerca_codice" && args.query) q = q.ilike("codice_articolo", `%${escapeIlike(args.query)}%`);
    else if (args.modalita === "cerca_descrizione" && args.query) q = q.ilike("descrizione", `%${escapeIlike(args.query)}%`);
    q = perPrezzo
      ? q.order("prezzo_unitario", { ascending: false, nullsFirst: false }).order("id", { ascending: true })
      : q.order("id", { ascending: true });
    return q.limit(limit * 5);
  };

  let righe: RigaRaw[];
  if (documenti) {
    righe = await perLotti<RigaRaw>(documenti.map((d) => d.id), cerca);
    if (perPrezzo) righe.sort((a, b) => (b.prezzo_unitario ?? 0) - (a.prezzo_unitario ?? 0));
    righe = righe.slice(0, limit * 5);
  } else {
    const { data, error } = await cerca(null);
    if (error) throw new Error("Errore lettura righe distinta");
    righe = (data ?? []) as RigaRaw[];
  }
  if (righe.length === 0) return [];

  const docMap = documenti ? new Map(documenti.map((d) => [d.id, d])) : await mappaDocumenti(righe.map((r) => r.documento_id));

  if (args.modalita === "top_costi") {
    const byCode = new Map<string, RigaDistintaRow>();
    for (const r of righe) {
      const key = r.codice_articolo ?? r.descrizione.slice(0, 40);
      const doc = docMap.get(r.documento_id);
      const esistente = byCode.get(key);
      if (!esistente || (r.prezzo_unitario ?? 0) > (esistente.prezzo_unitario ?? 0)) {
        byCode.set(key, {
          codice_articolo: r.codice_articolo,
          descrizione: r.descrizione,
          prezzo_unitario: r.prezzo_unitario,
          quantita: r.quantita,
          totale_riga: r.totale_riga,
          codice_preventivo: doc?.codice ?? null,
          cliente: doc?.cliente ?? null,
          n_utilizzi: (esistente?.n_utilizzi ?? 0) + 1,
        });
      } else {
        esistente.n_utilizzi++;
      }
    }
    return Array.from(byCode.values())
      .sort((a, b) => (b.prezzo_unitario ?? 0) - (a.prezzo_unitario ?? 0))
      .slice(0, limit);
  }

  return righe.slice(0, limit).map((r) => {
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
// Conta in quanti preventivi compare ogni codice articolo, dalle righe di
// distinta (prima si estraevano i codici dal testo dei chunk con una regex, e
// su una sola pagina di 1.000 chunk).

export async function toolTopArticoli(args: {
  categoria?: string;
  top_n?: number;
  filtro_cliente?: string;
  filtro_stato?: string;
}, clienteIds: string[] | null = null): Promise<TopArticoloRow[] | { risultati: TopArticoloRow[]; incompleto: true }> {
  const adminClient = createAdminClient();
  const topN = Math.min(args.top_n ?? 10, 30);
  const documenti = await documentiFiltrati({
    scope: scopeIds(clienteIds), categoria: args.categoria, cliente: args.filtro_cliente, stato: args.filtro_stato,
  });
  if (documenti && documenti.length === 0) return [];

  type RigaCodice = { documento_id: string; codice_articolo: string; descrizione: string | null };
  const base = () => adminClient
    .schema("preventivatore")
    .from("righe_distinta")
    .select("documento_id, codice_articolo, descrizione")
    .not("codice_articolo", "is", null)
    .neq("codice_articolo", "");

  let righe: RigaCodice[];
  let incompleto = false;
  if (documenti) {
    righe = [];
    const ids = documenti.map((d) => d.id);
    for (let i = 0; i < ids.length; i += LOTTO_ID) {
      const lotto = ids.slice(i, i + LOTTO_ID);
      const letto = await tutteLePagine<RigaCodice>((da, a) => base().in("documento_id", lotto).order("id", { ascending: true }).range(da, a));
      righe.push(...letto.righe);
      incompleto ||= letto.incompleto;
    }
  } else {
    const letto = await tutteLePagine<RigaCodice>((da, a) => base().order("id", { ascending: true }).range(da, a), 100_000);
    righe = letto.righe;
    incompleto = letto.incompleto;
  }

  const articoli = new Map<string, { docIds: Set<string>; descrizione: string }>();
  for (const riga of righe) {
    const codice = riga.codice_articolo.trim();
    if (!codice) continue;
    const voce = articoli.get(codice) ?? { docIds: new Set<string>(), descrizione: "" };
    voce.docIds.add(riga.documento_id);
    const descrizione = (riga.descrizione ?? "").trim();
    if (descrizione.length > voce.descrizione.length) voce.descrizione = descrizione;
    articoli.set(codice, voce);
  }

  const risultati = Array.from(articoli.entries())
    .map(([codice, v]) => ({ codice, n_preventivi: v.docIds.size, esempio_descrizione: v.descrizione.slice(0, 80) }))
    .filter((r) => r.n_preventivi >= 2)
    .sort((a, b) => b.n_preventivi - a.n_preventivi || a.codice.localeCompare(b.codice))
    .slice(0, topN);
  return incompleto ? { risultati, incompleto: true } : risultati;
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
}, clienteIds: string[] | null = null): Promise<AggRow[] | { risultati: AggRow[]; incompleto: true }> {
  const adminClient = createAdminClient();
  const scope = scopeIds(clienteIds);

  const rows: DocumentoRow[] = [];
  for (let da = 0; da < 20_000; da += 1_000) {
    let q = adminClient.schema("preventivatore").from("documenti").select("stato, cliente, categoria, importo_preventivo, importo_ordinato, data_offerta, codice, anno, numero_offerta");
    if (scope) q = q.in("cliente_master_id", scope);
    if (args.filtro_stato && isStatoDocumento(args.filtro_stato)) q = q.eq("stato", args.filtro_stato);
    if (args.filtro_cliente) q = q.ilike("cliente", `%${escapeIlike(args.filtro_cliente)}%`);
    if (args.filtro_anno) q = q.eq("anno", args.filtro_anno);
    if (typeof args.filtro_importo_min === "number") q = q.gte("importo_preventivo", args.filtro_importo_min);
    if (typeof args.filtro_importo_max === "number") q = q.lte("importo_preventivo", args.filtro_importo_max);
    const pagina = await q.order("codice", { ascending: true }).range(da, da + 999);
    if (pagina.error) throw new Error("Errore aggregazione dati");
    rows.push(...(pagina.data ?? []) as DocumentoRow[]);
    if ((pagina.data ?? []).length < 1_000) break;
  }
  const incompleto = rows.length >= 20_000;
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

  const risultati = Array.from(groupMap.entries())
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
  return incompleto ? { risultati, incompleto: true } : risultati;
}

// ─── Tool: dettaglio_preventivo ───────────────────────────────────────────────

export async function toolDettaglioPreventivo(args: { codice: string }, clienteIds: string[] | null = null): Promise<DettaglioRow | null> {
  const adminClient = createAdminClient();
  const scope = scopeIds(clienteIds);

  const SELECT_DOC = "id, codice, cliente, stato, categoria, importo_preventivo, importo_ordinato, importo_offerta, data_offerta, data_consegna_richiesta, data_consegna_confermata, data_consegna_effettiva, giorni_consegna_offerti, numero_offerta, numero_preventivo, tipo_cartella, tipo";

  // Cerca il codice in entrambe le notazioni (`C/25/25` ↔ `C_25_25`). Se non trova
  // nulla riprova con match parziale, che copre differenze di padding (C_25_25 vs C_25_025).
  async function cercaDoc(parziale: boolean) {
    let q = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select(SELECT_DOC)
      .or(filtroCodiceOr("codice", args.codice, parziale));
    if (scope) q = q.in("cliente_master_id", scope);
    return q.limit(1);
  }

  let { data: docs, error: docErr } = await cercaDoc(false);
  if (docErr) { console.error("dettaglio_preventivo doc error:", docErr); return null; }
  if (!docs || docs.length === 0) {
    ({ data: docs, error: docErr } = await cercaDoc(true));
    if (docErr) { console.error("dettaglio_preventivo doc error (parziale):", docErr); return null; }
  }
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

// ─── Tool nuovi per redazione preventivi (migration 043) ──────────────────────

async function toolCercaArticoloAnagrafica(args: {
  codice?: string;
  descrizione?: string;
  categoria?: string;
  fornitore?: string;
  solo_attivi?: boolean;
  limit?: number;
}) {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  let q = admin
    .schema("preventivatore")
    .from("prodotti")
    .select("codice, descrizione, ult_costo, data_ult_costo, categoria, gruppo, cat_merc, reparto_desc, fornitore, fornitore_codice, attivo")
    .order("data_ult_costo", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (args.solo_attivi !== false) q = q.eq("attivo", true);
  if (args.codice) {
    const cod = args.codice.trim();
    const esc = cod.replace(/[%_,]/g, (c) => `\\${c}`);
    q = q.or(`codice.eq.${cod},codice.ilike.%${esc}%`);
  }
  if (args.descrizione) q = q.ilike("descrizione", `%${args.descrizione.trim()}%`);
  if (args.categoria) q = q.or(`categoria.ilike.%${args.categoria}%,gruppo.ilike.%${args.categoria}%,cat_merc.ilike.%${args.categoria}%`);
  if (args.fornitore) {
    const f = args.fornitore.trim();
    q = q.or(`fornitore.ilike.%${f}%,fornitore_codice.ilike.%${f}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error("cerca_articolo_anagrafica: " + error.message);
  return data ?? [];
}

async function toolListinoServizi(args: { categoria?: string }) {
  const admin = createAdminClient();
  let q = admin
    .schema("preventivatore")
    .from("servizi_manodopera")
    .select("nome, categoria, tariffa_ora, unita, ordine")
    .eq("is_attivo", true)
    .order("ordine", { ascending: true })
    .order("nome", { ascending: true });
  if (args.categoria) q = q.ilike("categoria", `%${args.categoria}%`);
  const { data, error } = await q;
  if (error) throw new Error("listino_servizi: " + error.message);
  return data ?? [];
}

async function toolStoriaPrezziArticolo(args: { codice: string; anni?: number }, agenteCodice: string | null = null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .rpc("storia_prezzi_articolo", {
      p_codice: args.codice,
      p_anni: args.anni ?? 5,
      p_agente_codice: agenteCodice,
    });
  if (error) throw new Error("storia_prezzi_articolo: " + error.message);
  return data ?? [];
}

async function toolAnalisiMargini(args: {
  cliente?: string;
  categoria?: string;
  anno?: number;
  limit?: number;
}, agenteCodice: string | null = null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .rpc("analisi_margini", {
      p_cliente: args.cliente ?? null,
      p_categoria: args.categoria ?? null,
      p_anno: args.anno ?? null,
      p_limit: args.limit ?? 50,
      p_agente_codice: agenteCodice,
    });
  if (error) throw new Error("analisi_margini: " + error.message);
  return data ?? [];
}

async function toolHitRate(args: {
  cliente?: string;
  categoria?: string;
  mesi?: number;
  limit?: number;
}, agenteCodice: string | null = null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .rpc("hit_rate", {
      p_cliente: args.cliente ?? null,
      p_categoria: args.categoria ?? null,
      p_mesi: args.mesi ?? 24,
      p_limit: args.limit ?? 30,
      p_agente_codice: agenteCodice,
    });
  if (error) throw new Error("hit_rate: " + error.message);
  return data ?? [];
}

async function toolInfoCliente(args: { ragione: string; limit_preventivi?: number }, agenteCodice: string | null = null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .rpc("info_cliente", {
      p_ragione: args.ragione,
      p_limit_preventivi: args.limit_preventivi ?? 8,
      p_agente_codice: agenteCodice,
    });
  if (error) throw new Error("info_cliente: " + error.message);
  return data ?? {};
}

async function toolArticoliAssociati(args: { codice: string; min_freq?: number; limit?: number }, agenteCodice: string | null = null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .rpc("articoli_associati", {
      p_codice: args.codice,
      p_min_freq: args.min_freq ?? 2,
      p_limit: args.limit ?? 20,
      p_agente_codice: agenteCodice,
    });
  if (error) throw new Error("articoli_associati: " + error.message);
  return data ?? [];
}

async function toolTrendMensile(args: { months?: number; categoria?: string }, agenteCodice: string | null = null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .rpc("dashboard_serie_mensile_categoria", {
      months: Math.min(Math.max(args.months ?? 12, 1), 36),
      p_agente_codice: agenteCodice,
    });
  if (error) throw new Error("trend_mensile: " + error.message);
  // Filtro categoria post-hoc se richiesto (la RPC non lo accetta nativamente)
  if (args.categoria && Array.isArray(data)) {
    const cat = args.categoria.toLowerCase();
    return (data as Array<Record<string, unknown>>).filter((r) =>
      String(r.categoria ?? "").toLowerCase().includes(cat)
    );
  }
  return data ?? [];
}

// ─── Tool dispatch ────────────────────────────────────────────────────────────

/**
 * Scope commerciale per la chat AI: se `clienteIds` è un array, i tool che leggono
 * dati preventivo lo applicano (vedi `cliente_master_id`). NULL = nessun filtro.
 */
export interface ChatToolScope {
  clienteIds: string[] | null;
  agenteCodice: string | null;
}

export async function dispatchTool(name: string, args: Record<string, unknown>, scope?: ChatToolScope) {
  const ids = scope?.clienteIds ?? null;
  const agente = scope?.agenteCodice ?? null;
  const restricted = ids !== null;
  if (name === "list_preventivi")        return toolListPreventivi(args as Parameters<typeof toolListPreventivi>[0], ids);
  if (name === "cerca_simili")           return toolCercaSimili(args as Parameters<typeof toolCercaSimili>[0], ids);
  if (name === "cerca_articolo")         return toolCercaArticolo(args as Parameters<typeof toolCercaArticolo>[0], ids);
  if (name === "aggrega_preventivi")     return toolAggregatPreventivi(args as Parameters<typeof toolAggregatPreventivi>[0], ids);
  if (name === "top_articoli")           return toolTopArticoli(args as Parameters<typeof toolTopArticoli>[0], ids);
  if (name === "query_righe_distinta")   return toolQueryRigheDistinta(args as Parameters<typeof toolQueryRigheDistinta>[0], ids);
  if (name === "dettaglio_preventivo")   return toolDettaglioPreventivo(args as Parameters<typeof toolDettaglioPreventivo>[0], ids);
  if (name === "analisi_preventivi_sql") {
    // Le RPC ai_statistiche_* non sono scoped per agente: per i commerciali ristretti
    // restituiamo un messaggio invece di esporre aggregati globali.
    if (restricted) return { error: "Analisi aggregata non disponibile per il profilo commerciale ristretto. Usa lista/dettaglio sui tuoi preventivi." };
    return toolAnalisiPreventiviSql(args as Parameters<typeof toolAnalisiPreventiviSql>[0]);
  }
  if (name === "cerca_anomalie_importi") {
    if (restricted) return { error: "Analisi anomalie non disponibile per il profilo commerciale ristretto." };
    return toolCercaAnomalieImporti(args as Parameters<typeof toolCercaAnomalieImporti>[0]);
  }
  // Nuovi tool redazione preventivi (migration 043)
  if (name === "cerca_articolo_anagrafica") return toolCercaArticoloAnagrafica(args as Parameters<typeof toolCercaArticoloAnagrafica>[0]);
  if (name === "listino_servizi")           return toolListinoServizi(args as Parameters<typeof toolListinoServizi>[0]);
  if (name === "storia_prezzi_articolo")    return toolStoriaPrezziArticolo(args as Parameters<typeof toolStoriaPrezziArticolo>[0], agente);
  if (name === "analisi_margini")           return toolAnalisiMargini(args as Parameters<typeof toolAnalisiMargini>[0], agente);
  if (name === "hit_rate")                  return toolHitRate(args as Parameters<typeof toolHitRate>[0], agente);
  if (name === "info_cliente")              return toolInfoCliente(args as Parameters<typeof toolInfoCliente>[0], agente);
  if (name === "articoli_associati")        return toolArticoliAssociati(args as Parameters<typeof toolArticoliAssociati>[0], agente);
  if (name === "trend_mensile")             return toolTrendMensile(args as Parameters<typeof toolTrendMensile>[0], agente);
  throw new Error(`Tool sconosciuto: ${name}`);
}
