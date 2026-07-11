import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import {
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";
import { PostBodySchema } from "@/lib/portali/preventivatore/documenti-schema";
import { logError, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Route per un singolo preventivo generato dal builder:
//   GET  → ricostruisce lo stato del builder a PREZZI CONGELATI (per riaprire/modificare)
//   PUT  → salva le modifiche IN PLACE (RPC aggiorna_documento_dal_builder, migration 060)

type RigaRow = {
  codice_blocco: string | null;
  sheet_name: string | null;
  codice_articolo: string | null;
  descrizione: string;
  quantita: number | string | null;
  prezzo_unitario: number | string | null;
  ricarico_coefficiente: number | string | null;
  ricarico_pct: number | string | null;
  tipo_riga: string | null;
  scala_con_quantita: boolean | null;
};

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function verificaAccesso(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato", status: 401 as const };
  const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
  if (livello === null) return { error: "Accesso negato", status: 403 as const };
  return { user, livello };
}

// ── GET: stato builder a prezzi congelati (riapertura per modifica) ───────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const acc = await verificaAccesso(id);
    if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });
    const { user, livello } = acc;

    const sb = createAdminClient();

    const { data: doc, error: docErr } = await sb
      .schema("preventivatore")
      .from("documenti")
      .select("id, codice, cliente, cliente_master_id, tipo, tipo_prodotto, stato, note, margine_trattativa_pct, consegna_settimane_min, consegna_settimane_max, tempo_preventivazione_sec")
      .eq("id", id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
    if ((doc as { tipo: string }).tipo !== "generato") {
      return NextResponse.json({ error: "Solo i preventivi creati dal builder sono modificabili" }, { status: 422 });
    }

    // Filtro commerciale ristretto: il cliente deve essere nel portfolio
    const agente = await getFiltroCommerciale(user.id, livello);
    if (agente) {
      const cmId = (doc as { cliente_master_id: string | null }).cliente_master_id;
      if (!cmId) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
      const visibili = await getIdClientiVisibili(agente);
      if (!visibili.includes(cmId)) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const [blocchiRes, righeRes] = await Promise.all([
      sb
        .schema("preventivatore")
        .from("blocchi")
        // `ordine` (migration 065) preserva l'ordine dei blocchi del builder.
        // Fallback su created_at per eventuali righe legacy con ordine NULL.
        .select("codice_blocco, sheet_name, note, created_at, quantita_pezzi, margine_trattativa_pct")
        .eq("documento_id", id)
        .order("ordine", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      sb
        .schema("preventivatore")
        .from("righe_distinta")
        .select("codice_blocco, sheet_name, codice_articolo, descrizione, quantita, prezzo_unitario, ricarico_coefficiente, ricarico_pct, tipo_riga, scala_con_quantita")
        .eq("documento_id", id)
        .order("ordine", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true }),
    ]);
    if (blocchiRes.error) throw blocchiRes.error;
    if (righeRes.error) throw righeRes.error;

    const righe = (righeRes.data ?? []) as unknown as RigaRow[];
    const blocchiTable = (blocchiRes.data ?? []) as unknown as {
      codice_blocco: string | null; sheet_name: string | null; note: string | null;
      quantita_pezzi: number | null; margine_trattativa_pct: number | null;
    }[];

    const groupKey = (r: RigaRow) => r.codice_blocco ?? r.sheet_name ?? "Blocco";
    const ordineBlocchi: string[] = [];
    const noteBlocco = new Map<string, string>();
    const quantitaBlocco = new Map<string, number>();
    const margineBlocco = new Map<string, number | null>();
    for (const b of blocchiTable) {
      const k = b.codice_blocco ?? b.sheet_name ?? "Blocco";
      ordineBlocchi.push(k);
      if (b.note) noteBlocco.set(k, b.note);
      quantitaBlocco.set(k, b.quantita_pezzi ?? 1);
      margineBlocco.set(k, b.margine_trattativa_pct ?? null);
    }

    const perBlocco = new Map<string, RigaRow[]>();
    for (const r of righe) {
      const k = groupKey(r);
      if (!ordineBlocchi.includes(k)) ordineBlocchi.push(k);
      const arr = perBlocco.get(k) ?? [];
      arr.push(r);
      perBlocco.set(k, arr);
    }

    const blocchi = ordineBlocchi
      .filter((k) => (perBlocco.get(k) ?? []).length > 0)
      .map((k) => {
        const rs = perBlocco.get(k) ?? [];
        const articoli = rs
          .filter((r) => r.tipo_riga !== "manodopera")
          .map((r) => ({
            codice: r.codice_articolo ?? "",
            descrizione: r.descrizione ?? "",
            qty: num(r.quantita),
            // PREZZO CONGELATO: usa il costo salvato, non quello corrente.
            ult_costo: num(r.prezzo_unitario),
            coeff_ricarico: num(r.ricarico_coefficiente) || num(r.ricarico_pct) || 0.5,
            data_ult_costo: null,
          }));

        const servizi = rs
          .filter((r) => r.tipo_riga === "manodopera")
          .map((r) => ({
            nome: r.descrizione ?? "",
            categoria: "",
            ore: num(r.quantita),
            tariffa_ora: num(r.prezzo_unitario),
            coeff_ricarico: num(r.ricarico_coefficiente) || num(r.ricarico_pct) || 0.5,
            scala_con_quantita: r.scala_con_quantita ?? true,
          }));

        return {
          nome: k === "Blocco" || k === "builder" ? "" : k,
          tipo: k && k !== "builder" ? k : "Altro",
          note: noteBlocco.get(k) ?? "",
          quantita_pezzi: quantitaBlocco.get(k) ?? 1,
          margine_trattativa_pct: margineBlocco.get(k) ?? null,
          articoli,
          servizi,
        };
      });

    // Cliente master
    let cliente: Record<string, unknown> | null = null;
    const cmId = (doc as { cliente_master_id: string | null }).cliente_master_id;
    if (cmId) {
      const { data: cm } = await sb
        .schema("preventivatore")
        .from("clienti_master")
        .select("id, codice_cliente, ragione_sociale, destinazione, id_destinazione, cap, localita, cat_zona, agente_nome, agente_codice, cat_commerciale")
        .eq("id", cmId)
        .maybeSingle();
      if (cm) {
        const r = cm as Record<string, string | null>;
        const provMatch = r.cat_zona ? /^([A-Z]{2})/.exec(r.cat_zona) : null;
        cliente = {
          id: r.id,
          codice_cliente: r.codice_cliente,
          ragione_sociale: r.ragione_sociale,
          destinazione: r.destinazione,
          id_destinazione: r.id_destinazione,
          piva: null,
          citta: r.localita,
          provincia: provMatch ? provMatch[1] : null,
          agente_nome: r.agente_nome,
          agente_codice: r.agente_codice,
          cat_commerciale: r.cat_commerciale,
          is_hq: (r.ragione_sociale ?? "").trim() === (r.destinazione ?? "").trim(),
        };
      }
    }

    const d = doc as {
      codice: string | null; stato: string | null; tipo_prodotto: string | null;
      note: string | null; margine_trattativa_pct: number | null;
      consegna_settimane_min: number | null; consegna_settimane_max: number | null;
      tempo_preventivazione_sec: number | null;
    };

    return NextResponse.json({
      documento: {
        id,
        codice: d.codice,
        stato: d.stato,
        tempo_preventivazione_sec: d.tempo_preventivazione_sec,
      },
      titolo: d.tipo_prodotto ?? "",
      cliente,
      note: d.note ?? "",
      margine_trattativa_pct: d.margine_trattativa_pct,
      consegna_settimane_min: d.consegna_settimane_min,
      consegna_settimane_max: d.consegna_settimane_max,
      blocchi,
    });
  } catch (error) {
    logError("preventivatore.documenti", "GET documento builder fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

// ── PUT: salva le modifiche del builder IN PLACE ──────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const acc = await verificaAccesso(id);
    if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });
    const { user, livello } = acc;

    const rawBody = await request.json().catch(() => null);
    const parsed = PostBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const admin = createAdminClient();

    // Il documento deve esistere, essere generato e (se commerciale ristretto) nel portfolio.
    const { data: doc, error: docErr } = await admin
      .schema("preventivatore")
      .from("documenti")
      .select("id, tipo, cliente_master_id")
      .eq("id", id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
    if ((doc as { tipo: string }).tipo !== "generato") {
      return NextResponse.json({ error: "Solo i preventivi creati dal builder sono modificabili" }, { status: 422 });
    }

    const agente = await getFiltroCommerciale(user.id, livello);
    if (agente) {
      const visibili = await getIdClientiVisibili(agente);
      const cmOld = (doc as { cliente_master_id: string | null }).cliente_master_id;
      // Il cliente attuale del documento e quello nuovo devono entrambi essere visibili.
      if (cmOld && !visibili.includes(cmOld)) {
        return NextResponse.json({ error: "Preventivo fuori dal tuo portfolio" }, { status: 403 });
      }
      if (body.cliente_master_id && !visibili.includes(body.cliente_master_id)) {
        return NextResponse.json({ error: "Cliente fuori dal tuo portfolio" }, { status: 403 });
      }
    }

    const { data: result, error: rpcErr } = await admin
      .schema("preventivatore")
      .rpc("aggiorna_documento_dal_builder", { p_id: id, p_payload: body });

    if (rpcErr || !result) {
      logError("preventivatore.documenti", "aggiorna_documento_dal_builder fallita", rpcErr, { reqId: id });
      return NextResponse.json(
        { error: "Errore aggiornamento documento: " + (rpcErr?.message ?? "unknown") },
        { status: 500 }
      );
    }

    const r = result as { id: string; codice: string };

    // Tempo di preventivazione (come per la create): update mirato best-effort.
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
    logError("preventivatore.documenti", "PUT documento builder fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
