import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import {
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";

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
//     servizi:  Array<{ nome: string, categoria?: string, ore: number, tariffa_ora: number, markup: number }>
//   }>
// }
//
// Crea: 1 documenti (tipo='generato', tipo_cartella='G', stato='aperta') +
// N blocchi + M righe_distinta (materiale + manodopera con tipo_riga) +
// 1 chunks testo riassuntivo (embedding generato fuori banda).

interface BloccoInput {
  nome?: string;
  tipo?: string;
  note?: string;
  articoli: Array<{
    codice: string;
    descrizione: string;
    qty: number;
    ult_costo: number;
    coeff_ricarico: number;
  }>;
  servizi: Array<{
    nome: string;
    categoria?: string;
    ore: number;
    tariffa_ora: number;
    markup: number;
  }>;
}

interface PostBody {
  titolo?: string;
  cliente_master_id?: string;
  cliente_text?: string;
  numero_preventivo?: string;
  data_consegna?: string;
  codice?: string;
  note?: string;
  blocchi: BloccoInput[];
}

function calcNettoArticolo(a: { ult_costo: number; qty: number; coeff_ricarico: number }) {
  if (!a.coeff_ricarico || a.coeff_ricarico <= 0) return 0;
  return (a.ult_costo * a.qty) / a.coeff_ricarico;
}

function calcTotaleServizio(s: { tariffa_ora: number; ore: number; markup: number }) {
  return s.tariffa_ora * s.ore * (1 + (s.markup ?? 0) / 100);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = (await request.json().catch(() => null)) as PostBody | null;
    if (!body || !Array.isArray(body.blocchi)) {
      return NextResponse.json({ error: "Body invalido: blocchi mancanti" }, { status: 400 });
    }
    if (body.blocchi.length === 0) {
      return NextResponse.json({ error: "Almeno un blocco è richiesto" }, { status: 400 });
    }
    if (!body.cliente_master_id && !body.cliente_text?.trim()) {
      return NextResponse.json({ error: "Cliente mancante" }, { status: 400 });
    }

    const admin = createAdminClient();
    const anno = new Date().getFullYear();
    const annoSuffix = String(anno).slice(2);

    // ── Codice cartella: manuale o auto-incremento G_YY_NNN ───────────────
    let codice = body.codice?.trim();
    if (!codice) {
      const prefix = `G_${annoSuffix}_`;
      const { data: existing } = await admin
        .schema("preventivatore")
        .from("documenti")
        .select("codice")
        .like("codice", `${prefix}%`)
        .order("codice", { ascending: false })
        .limit(1);
      const maxN = existing && existing[0]
        ? parseInt((existing[0].codice as string).slice(prefix.length), 10) || 0
        : 0;
      codice = `${prefix}${String(maxN + 1).padStart(3, "0")}`;
    }

    // ── Risolvi cliente da clienti_master se passato ─────────────────────
    let ragioneSociale: string | null = body.cliente_text?.trim() ?? null;
    let codiceArtAggregati: string[] = [];

    if (body.cliente_master_id) {
      const { data: cm } = await admin
        .schema("preventivatore")
        .from("clienti_master")
        .select("ragione_sociale, destinazione")
        .eq("id", body.cliente_master_id)
        .maybeSingle();
      if (cm) ragioneSociale = cm.ragione_sociale;
    }

    // ── Aggrega codici articolo ──────────────────────────────────────────
    for (const b of body.blocchi) {
      for (const a of b.articoli ?? []) {
        if (a.codice && !codiceArtAggregati.includes(a.codice)) {
          codiceArtAggregati.push(a.codice);
        }
      }
    }

    // ── Totali ───────────────────────────────────────────────────────────
    let totaleMateriali = 0;
    let totaleServizi = 0;
    for (const b of body.blocchi) {
      for (const a of b.articoli ?? []) totaleMateriali += calcNettoArticolo(a);
      for (const s of b.servizi ?? []) totaleServizi += calcTotaleServizio(s);
    }
    const importoTotale = totaleMateriali + totaleServizi;

    // ── INSERT documenti ─────────────────────────────────────────────────
    const { data: doc, error: docErr } = await admin
      .schema("preventivatore")
      .from("documenti")
      .insert({
        codice,
        tipo: "generato",
        tipo_cartella: "G",
        stato: "aperta",
        cliente: ragioneSociale,
        cliente_master_id: body.cliente_master_id ?? null,
        anno,
        tipo_prodotto: body.titolo?.trim() || null,
        codici_articolo: codiceArtAggregati,
        importo_preventivo: importoTotale,
        importo_finale_raw: importoTotale,
        importo_source: "builder",
        versione_ingest: "builder_v1",
        numero_preventivo: body.numero_preventivo?.trim() || null,
        data_consegna_richiesta: body.data_consegna || null,
        note: body.note?.trim() || null,
        creato_da: user.id,
      })
      .select("id, codice")
      .single();

    if (docErr || !doc) {
      console.error("POST documenti insert error:", docErr);
      return NextResponse.json({ error: "Errore creazione documento: " + (docErr?.message ?? "unknown") }, { status: 500 });
    }
    const documentoId = doc.id;

    // ── INSERT blocchi + righe_distinta (materiale + manodopera) ─────────
    const blocchiPayload = body.blocchi.map((b, idx) => {
      const tot =
        (b.articoli ?? []).reduce((s, a) => s + calcNettoArticolo(a), 0) +
        (b.servizi ?? []).reduce((s, sv) => s + calcTotaleServizio(sv), 0);
      return {
        documento_id: documentoId,
        codice_blocco: b.nome?.trim() || b.tipo?.trim() || `Blocco ${idx + 1}`,
        sheet_name: "builder",
        totale_raw: tot,
        totale_ceil_2: Math.ceil(tot * 100) / 100,
        incluso_offerta: true,
      };
    });
    const { error: bErr } = await admin.schema("preventivatore").from("blocchi").insert(blocchiPayload);
    if (bErr) console.error("POST blocchi insert error:", bErr);

    const righe: Array<Record<string, unknown>> = [];
    for (const b of body.blocchi) {
      const codBlock = b.nome?.trim() || b.tipo?.trim() || null;
      for (const a of b.articoli ?? []) {
        righe.push({
          documento_id: documentoId,
          sheet_name: "builder",
          codice_blocco: codBlock,
          codice_articolo: a.codice,
          descrizione: a.descrizione,
          quantita: a.qty,
          prezzo_unitario: a.ult_costo,
          ricarico_pct: a.coeff_ricarico,
          ricarico_coefficiente: a.coeff_ricarico,
          totale_riga: calcNettoArticolo(a),
          totale_riga_ceil_2: Math.ceil(calcNettoArticolo(a) * 100) / 100,
          tipo_riga: "materiale",
        });
      }
      for (const s of b.servizi ?? []) {
        righe.push({
          documento_id: documentoId,
          sheet_name: "builder",
          codice_blocco: codBlock,
          codice_articolo: null,
          descrizione: s.nome,
          quantita: s.ore,
          prezzo_unitario: s.tariffa_ora,
          ricarico_pct: s.markup ?? 0,
          totale_riga: calcTotaleServizio(s),
          totale_riga_ceil_2: Math.ceil(calcTotaleServizio(s) * 100) / 100,
          tipo_riga: "manodopera",
        });
      }
    }
    if (righe.length > 0) {
      const { error: rErr } = await admin.schema("preventivatore").from("righe_distinta").insert(righe);
      if (rErr) console.error("POST righe_distinta insert error:", rErr);
    }

    // ── 1 chunk testuale riassuntivo (embedding generato fuori banda) ────
    const riassunto = [
      `Preventivo ${doc.codice}`,
      ragioneSociale ? `Cliente: ${ragioneSociale}` : null,
      body.titolo ? `Titolo: ${body.titolo}` : null,
      body.numero_preventivo ? `N. offerta: ${body.numero_preventivo}` : null,
      `Importo: ${importoTotale.toFixed(2)} EUR (materiali ${totaleMateriali.toFixed(2)}, manodopera ${totaleServizi.toFixed(2)})`,
      `Blocchi: ${body.blocchi.length}`,
      ...body.blocchi.map((b, i) => {
        const codici = (b.articoli ?? []).map((a) => a.codice).filter(Boolean).join(", ");
        return `[Blocco ${i + 1} ${b.tipo ?? ""} ${b.nome ?? ""}] articoli: ${codici || "—"}`;
      }),
      body.note ? `Note: ${body.note}` : null,
    ].filter(Boolean).join("\n");

    await admin.schema("preventivatore").from("chunks").insert({
      documento_id: documentoId,
      chunk_index: 0,
      contenuto: riassunto,
      metadata: {
        tipo: "preventivo_generato",
        builder_state: {
          totali: {
            materiali: totaleMateriali,
            servizi: totaleServizi,
            netto_totale: importoTotale,
            n_blocchi: body.blocchi.length,
          },
          n_articoli: righe.filter((r) => r.tipo_riga === "materiale").length,
        },
      },
    });

    return NextResponse.json({ id: documentoId, codice: doc.codice });
  } catch (error) {
    console.error("POST documenti error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
