import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

// Whitelist colonne ordinabili per evitare SQL injection.
const SORT_COLUMNS = new Set([
  "codice",
  "cliente",
  "importo_preventivo",
  "data_offerta",
  "created_at",
  "stato",
]);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const statsMode = searchParams.get("stats") === "true";
    const adminClient = createAdminClient();

    if (statsMode) {
      const { data: docs, error: docsError } = await adminClient
        .schema("preventivatore")
        .from("documenti")
        .select("stato");

      const { count: chunksCount } = await adminClient
        .schema("preventivatore")
        .from("chunks")
        .select("*", { count: "exact", head: true });

      if (docsError) {
        return NextResponse.json({ error: "Errore recupero statistiche" }, { status: 500 });
      }

      const allDocs = docs ?? [];
      return NextResponse.json({
        totale: allDocs.length,
        pending: allDocs.filter((d) => d.stato === "pending").length,
        ordinato: allDocs.filter((d) => d.stato === "ordinato").length,
        rifiutato: allDocs.filter((d) => d.stato === "rifiutato").length,
        total_chunks: chunksCount ?? 0,
      });
    }

    // ── Filtri ─────────────────────────────────────────────────────────────
    const q = (searchParams.get("q") ?? "").trim();
    const stato = searchParams.get("stato");
    const cliente = searchParams.get("cliente");
    const tipo = searchParams.get("tipo"); // storico | generato
    const categoria = searchParams.get("categoria");
    const importoMin = searchParams.get("importo_min");
    const importoMax = searchParams.get("importo_max");

    // ── Ordinamento ────────────────────────────────────────────────────────
    const sortRaw = searchParams.get("sort") ?? "created_at";
    const sort = SORT_COLUMNS.has(sortRaw) ? sortRaw : "created_at";
    const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";

    // ── Paginazione ────────────────────────────────────────────────────────
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
    const offset = (page - 1) * limit;

    let query = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select(
        "id, codice, cliente, stato, categoria, tipo, numero_offerta, data_offerta, importo_preventivo, importo_ordinato, created_at",
        { count: "exact" }
      )
      .order(sort, { ascending: dir === "asc", nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (stato && stato !== "tutti") query = query.eq("stato", stato);
    if (cliente) query = query.eq("cliente", cliente);
    if (tipo && tipo !== "tutti") query = query.eq("tipo", tipo);
    if (categoria) query = query.eq("categoria", categoria);

    const importoMinNum = importoMin ? parseFloat(importoMin) : NaN;
    const importoMaxNum = importoMax ? parseFloat(importoMax) : NaN;
    if (!isNaN(importoMinNum)) query = query.gte("importo_preventivo", importoMinNum);
    if (!isNaN(importoMaxNum)) query = query.lte("importo_preventivo", importoMaxNum);

    if (q) {
      const escaped = q.replace(/[%_,]/g, (c) => `\\${c}`);
      // Free-text su codice, numero_offerta, cliente
      query = query.or(`codice.ilike.%${escaped}%,numero_offerta.ilike.%${escaped}%,cliente.ilike.%${escaped}%`);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("Documenti list error:", error);
      return NextResponse.json({ error: "Errore recupero documenti" }, { status: 500 });
    }

    const totalPages = Math.max(1, Math.ceil((count ?? 0) / limit));

    return NextResponse.json({
      items: data ?? [],
      total: count ?? 0,
      page,
      limit,
      total_pages: totalPages,
      sort,
      dir,
    });
  } catch (error) {
    console.error("Documenti GET error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
