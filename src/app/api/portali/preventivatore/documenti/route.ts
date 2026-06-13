import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PostBodySchema } from "@/lib/portali/preventivatore/documenti-schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import {
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";
import { logError, logWarn } from "@/lib/logger";

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
      // Scope commerciale: le statistiche devono riflettere solo i documenti visibili.
      const agenteStats = await getFiltroCommerciale(user.id, livello);
      let docsQuery = adminClient
        .schema("preventivatore")
        .from("documenti")
        .select("stato");
      if (agenteStats) {
        const idsClienti = await getIdClientiVisibili(agenteStats);
        docsQuery = docsQuery.in(
          "cliente_master_id",
          idsClienti.length > 0 ? idsClienti : ["00000000-0000-0000-0000-000000000000"]
        );
      }
      const { data: docs, error: docsError } = await docsQuery;

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

    // Filtro "io commerciale vedo solo i miei clienti" (vedi lib/portali/preventivatore/ruoli.ts).
    // Trasparente per admin/back_office/preventivatore o per utenti senza ruolo commerciale.
    const agenteCommerciale = await getFiltroCommerciale(user.id, livello);
    if (agenteCommerciale) {
      const idsClienti = await getIdClientiVisibili(agenteCommerciale);
      if (idsClienti.length === 0) {
        // Commerciale senza clienti: restituisce 0 record
        query = query.in("cliente_master_id", ["00000000-0000-0000-0000-000000000000"]);
      } else {
        query = query.in("cliente_master_id", idsClienti);
      }
    }

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
      logError("preventivatore.documenti", "lista documenti fallita", error);
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
    logError("preventivatore.documenti", "GET documenti fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

// ── POST: salva nuovo preventivo dal builder ─────────────────────────────────
// Body: {
//   titolo?: string,
//   cliente_master_id?: string,    // FK al record clienti_master scelto
//   cliente_text?: string,         // fallback testuale (se cliente non in master)
//   numero_preventivo?: string,    // PC N° del registro (opzionale)
//   data_consegna?: string,        // ISO date (data consegna richiesta dal cliente)
//   codice?: string,               // codice cartella manuale (es. "G_26_001"); auto-incremento se omesso
//   note?: string,
//   blocchi: Array<{
//     nome?: string, tipo?: string, note?: string,
//     articoli: Array<{ codice: string, descrizione: string, qty: number, ult_costo: number, coeff_ricarico: number }>,
//     servizi:  Array<{ nome: string, categoria?: string, ore: number, tariffa_ora: number, coeff_ricarico: number }>
//   }>
// }
//
// Crea: 1 documenti (tipo='generato', tipo_cartella='G', stato='aperta') +
// N blocchi + M righe_distinta (materiale + manodopera con tipo_riga) +
// 1 chunks testo riassuntivo (embedding generato fuori banda).
//
// Coefficiente di ricarico SICS: prezzo = costo / coeff (vale per materiali e manodopera).

// Schema Zod del payload builder: estratto in lib condivisa (le route Next non
// possono esportare simboli non standard) e riusato dal PUT in documenti/[id].

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    // ── 1) Validazione Zod del payload (limiti severi server-side) ──────
    const rawBody = await request.json().catch(() => null);
    const parsed = PostBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // ── 2) Filtro portfolio commerciale: il cliente_master_id deve essere visibile ──
    const agenteCommerciale = await getFiltroCommerciale(user.id, livello);
    if (agenteCommerciale && body.cliente_master_id) {
      const idsVisibili = await getIdClientiVisibili(agenteCommerciale);
      if (!idsVisibili.includes(body.cliente_master_id)) {
        return NextResponse.json(
          { error: "Cliente fuori dal tuo portfolio" },
          { status: 403 }
        );
      }
    }

    // ── 3) Chiama RPC atomico (transazione + ROLLBACK su errore) ────────
    const admin = createAdminClient();
    // Inietta user_id nel payload (l'RPC lo leggerà da _user_id)
    const payloadConUser = { ...body, _user_id: user.id };
    const { data: result, error: rpcErr } = await admin
      .schema("preventivatore")
      .rpc("crea_documento_dal_builder", { p_payload: payloadConUser });

    if (rpcErr || !result) {
      logError("preventivatore.documenti", "crea_documento_dal_builder fallita", rpcErr);
      return NextResponse.json(
        { error: "Errore creazione documento: " + (rpcErr?.message ?? "unknown") },
        { status: 500 }
      );
    }

    // result è già {id, codice} dal RPC
    const r = result as { id: string; codice: string };

    // Registra il tempo di preventivazione (cronometro builder) sul documento
    // appena creato. Best-effort: se fallisce non compromette la creazione.
    if (typeof body.tempo_preventivazione_sec === "number" && body.tempo_preventivazione_sec > 0) {
      const { error: tempoErr } = await admin
        .schema("preventivatore")
        .from("documenti")
        .update({ tempo_preventivazione_sec: body.tempo_preventivazione_sec })
        .eq("id", r.id);
      if (tempoErr) logWarn("preventivatore.documenti", "tempo_preventivazione non salvato", { reqId: r.id, dettaglio: tempoErr.message });
    }

    return NextResponse.json({ id: r.id, codice: r.codice });
  } catch (error) {
    logError("preventivatore.documenti", "POST documenti fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

