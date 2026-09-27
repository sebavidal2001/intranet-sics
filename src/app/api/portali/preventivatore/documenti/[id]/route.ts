import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPreventivatoreScope,
  haRuoloFunzionale,
  PREVENTIVATORE_RUOLI,
} from "@/lib/portali/preventivatore/ruoli";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { requireDocumentoVisibile } from "@/lib/portali/preventivatore/documento-visibile";
import { PostBodySchema } from "@/lib/portali/preventivatore/documenti-schema";
import { STATI_NON_MODIFICABILI } from "@/lib/portali/preventivatore/stati";
import { indicizzaDocumento } from "@/lib/portali/preventivatore/indicizzazione";
import { logError } from "@/lib/logger";

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

    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const visibilita = await requireDocumentoVisibile(
      { userId: guard.user.id, livello: guard.ctx.livello },
      id,
    );
    if (!visibilita.ok) {
      return NextResponse.json({ error: visibilita.error }, { status: visibilita.status });
    }

    const sb = createAdminClient();

    const { data: doc, error: docErr } = await sb
      .schema("preventivatore")
      .from("documenti")
      .select("id, codice, cliente, cliente_master_id, tipo, tipo_prodotto, stato, note, margine_trattativa_pct, consegna_settimane_min, consegna_settimane_max, tempo_preventivazione_sec, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
    if ((doc as { tipo: string }).tipo !== "generato") {
      return NextResponse.json({ error: "Solo i preventivi creati dal builder sono modificabili" }, { status: 422 });
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
      updated_at: string;
    };

    return NextResponse.json({
      documento: {
        id,
        codice: d.codice,
        stato: d.stato,
        tempo_preventivazione_sec: d.tempo_preventivazione_sec,
        updated_at: d.updated_at,
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

    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user, ctx } = guard;

    // Come per la creazione: modificare la distinta è del preventivatore.
    // Un commerciale in sola lettura non deve poter riscrivere un preventivo.
    if (!haRuoloFunzionale(ctx, [PREVENTIVATORE_RUOLI.preventivatore])) {
      return NextResponse.json(
        { error: "Per modificare un preventivo serve il ruolo 'preventivatore'." },
        { status: 403 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = PostBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const visibilita = await requireDocumentoVisibile(
      { userId: user.id, livello: ctx.livello },
      id,
    );
    if (!visibilita.ok) {
      return NextResponse.json({ error: visibilita.error }, { status: visibilita.status });
    }

    const admin = createAdminClient();

    // Il documento deve esistere, essere generato e (se commerciale ristretto) nel portfolio.
    const { data: doc, error: docErr } = await admin
      .schema("preventivatore")
      .from("documenti")
      .select("id, tipo, stato, cliente_master_id")
      .eq("id", id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
    if ((doc as { tipo: string }).tipo !== "generato") {
      return NextResponse.json({ error: "Solo i preventivi creati dal builder sono modificabili" }, { status: 422 });
    }

    // Oltre l'invio al cliente il preventivo non si riscrive. Senza questo
    // controllo la PUT accettava qualunque stato: distinta, ore e totali
    // cambiavano mentre `numero_preventivo` e `importo_offerta` restavano
    // quelli dell'offerta già partita, e i due valori non corrispondevano più.
    const statoDoc = (doc as { stato: string }).stato;
    if ((STATI_NON_MODIFICABILI as readonly string[]).includes(statoDoc)) {
      return NextResponse.json(
        {
          error:
            `Il preventivo è nello stato '${statoDoc}': non è più modificabile. ` +
            `Duplicalo con «Crea preventivo da questa base» per partire da qui.`,
        },
        { status: 409 }
      );
    }

    const scope = await getPreventivatoreScope(user.id, ctx.livello);
    if (scope.restricted) {
      if (body.cliente_master_id && !scope.clienteIds.includes(body.cliente_master_id)) {
        return NextResponse.json({ error: "Cliente fuori dal tuo portfolio" }, { status: 403 });
      }
    }

    const { data: result, error: rpcErr } = await admin
      .schema("preventivatore")
      .rpc("aggiorna_documento_dal_builder", { p_id: id, p_payload: body });

    if (rpcErr || !result) {
      if (rpcErr?.code === "PT409" || rpcErr?.message?.includes("versione_obsoleta")) {
        return NextResponse.json(
          { error: "Il preventivo è stato modificato da qualcun altro. Il tuo lavoro è ancora qui: ricarica e riconcilia le modifiche prima di salvare." },
          { status: 409 },
        );
      }
      logError("preventivatore.documenti", "aggiorna_documento_dal_builder fallita", rpcErr, { reqId: id });
      return NextResponse.json(
        { error: "Errore aggiornamento documento: " + (rpcErr?.message ?? "unknown") },
        { status: 500 }
      );
    }

    const r = result as { id: string; codice: string };

    await indicizzaDocumento(r.id, { timeoutMs: 8000 });

    return NextResponse.json({ id: r.id, codice: r.codice });
  } catch (error) {
    logError("preventivatore.documenti", "PUT documento builder fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
