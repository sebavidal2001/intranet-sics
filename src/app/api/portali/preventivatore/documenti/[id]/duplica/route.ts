import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import {
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";

export const dynamic = "force-dynamic";

// ── GET: restituisce un preventivo come "base" per il builder ────────────────
// Ricostruisce blocchi + articoli + servizi nel formato atteso dal builder,
// ri-leggendo i prezzi correnti dall'anagrafica (prodotti.ult_costo) e dal
// listino lavorazioni (servizi_manodopera.tariffa_ora). Segnala i valori
// cambiati rispetto all'originale così l'utente vede cosa è stato aggiornato.
//
// Risposta:
// {
//   titolo, cliente, blocchi: [...],
//   avvisi: { articoli_aggiornati, servizi_aggiornati, articoli_non_trovati }
// }

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const sb = createAdminClient();

    // 1) Documento + cliente
    const { data: doc, error: docErr } = await sb
      .schema("preventivatore")
      .from("documenti")
      .select("id, codice, cliente, cliente_master_id, tipo, margine_trattativa_pct, consegna_settimane_min, consegna_settimane_max")
      .eq("id", id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });

    // Filtro commerciale ristretto: il cliente deve essere nel portfolio
    const agente = await getFiltroCommerciale(user.id, livello);
    if (agente) {
      const cmId = (doc as { cliente_master_id: string | null }).cliente_master_id;
      if (!cmId) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
      const visibili = await getIdClientiVisibili(agente);
      if (!visibili.includes(cmId)) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    // 2) Blocchi (presenti solo per i generati) + righe
    const [blocchiRes, righeRes] = await Promise.all([
      sb
        .schema("preventivatore")
        .from("blocchi")
        .select("codice_blocco, sheet_name, note, created_at, quantita_pezzi, margine_trattativa_pct")
        .eq("documento_id", id)
        .order("created_at", { ascending: true }),
      sb
        .schema("preventivatore")
        .from("righe_distinta")
        .select("codice_blocco, sheet_name, codice_articolo, descrizione, quantita, prezzo_unitario, ricarico_coefficiente, ricarico_pct, tipo_riga, scala_con_quantita")
        .eq("documento_id", id)
        .order("id", { ascending: true }),
    ]);
    if (blocchiRes.error) throw blocchiRes.error;
    if (righeRes.error) throw righeRes.error;

    const righe = (righeRes.data ?? []) as unknown as RigaRow[];
    const blocchiTable = (blocchiRes.data ?? []) as unknown as {
      codice_blocco: string | null; sheet_name: string | null; note: string | null;
      quantita_pezzi: number | null; margine_trattativa_pct: number | null;
    }[];

    // 3) Re-fetch prezzi correnti
    const codiciMateriale = Array.from(
      new Set(
        righe
          .filter((r) => r.tipo_riga !== "manodopera" && r.codice_articolo)
          .map((r) => r.codice_articolo as string)
      )
    );
    const prezziCorrenti = new Map<string, number>();
    const dateCorrenti = new Map<string, string | null>();
    if (codiciMateriale.length > 0) {
      const { data: prodotti } = await sb
        .schema("preventivatore")
        .from("prodotti")
        .select("codice, ult_costo, data_ult_costo")
        .in("codice", codiciMateriale);
      for (const p of (prodotti ?? []) as { codice: string; ult_costo: number | null; data_ult_costo: string | null }[]) {
        if (p.ult_costo != null) prezziCorrenti.set(p.codice, Number(p.ult_costo));
        dateCorrenti.set(p.codice, p.data_ult_costo);
      }
    }

    // Tariffe correnti lavorazioni (match per nome)
    const tariffeCorrenti = new Map<string, { tariffa: number; categoria: string }>();
    {
      const { data: servizi } = await sb
        .schema("preventivatore")
        .from("servizi_manodopera")
        .select("nome, categoria, tariffa_ora, is_attivo")
        .eq("is_attivo", true);
      for (const s of (servizi ?? []) as { nome: string; categoria: string; tariffa_ora: number }[]) {
        tariffeCorrenti.set(s.nome.trim().toLowerCase(), {
          tariffa: Number(s.tariffa_ora),
          categoria: s.categoria,
        });
      }
    }

    // 4) Raggruppa righe per blocco
    const groupKey = (r: RigaRow) => r.codice_blocco ?? r.sheet_name ?? "Blocco";
    const ordineBlocchi: string[] = [];
    if (blocchiTable.length > 0) {
      for (const b of blocchiTable) ordineBlocchi.push(b.codice_blocco ?? b.sheet_name ?? "Blocco");
    }
    const noteBlocco = new Map<string, string>();
    const quantitaBlocco = new Map<string, number>();
    const margineBlocco = new Map<string, number | null>();
    for (const b of blocchiTable) {
      const k = b.codice_blocco ?? b.sheet_name ?? "Blocco";
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

    let articoliAggiornati = 0;
    let serviziAggiornati = 0;
    let articoliNonTrovati = 0;

    const blocchi = ordineBlocchi
      .filter((k) => (perBlocco.get(k) ?? []).length > 0)
      .map((k) => {
        const rs = perBlocco.get(k) ?? [];
        const articoli = rs
          .filter((r) => r.tipo_riga !== "manodopera")
          .map((r) => {
            const originale = num(r.prezzo_unitario);
            const corrente = r.codice_articolo ? prezziCorrenti.get(r.codice_articolo) : undefined;
            const trovato = corrente !== undefined;
            if (!trovato && r.codice_articolo) articoliNonTrovati++;
            const ultCosto = trovato ? (corrente as number) : originale;
            const cambiato = trovato && Math.abs(ultCosto - originale) > 0.001;
            if (cambiato) articoliAggiornati++;
            return {
              codice: r.codice_articolo ?? "",
              descrizione: r.descrizione ?? "",
              qty: num(r.quantita),
              ult_costo: ultCosto,
              coeff_ricarico: num(r.ricarico_coefficiente) || num(r.ricarico_pct) || 0.5,
              data_ult_costo: r.codice_articolo ? (dateCorrenti.get(r.codice_articolo) ?? null) : null,
              ult_costo_originale: originale,
              prezzo_cambiato: cambiato,
              trovato_anagrafica: trovato,
            };
          });

        const servizi = rs
          .filter((r) => r.tipo_riga === "manodopera")
          .map((r) => {
            const originale = num(r.prezzo_unitario);
            const match = tariffeCorrenti.get((r.descrizione ?? "").trim().toLowerCase());
            const tariffa = match ? match.tariffa : originale;
            const cambiato = match != null && Math.abs(tariffa - originale) > 0.001;
            if (cambiato) serviziAggiornati++;
            return {
              nome: r.descrizione ?? "",
              categoria: match?.categoria ?? "",
              ore: num(r.quantita),
              tariffa_ora: tariffa,
              coeff_ricarico: num(r.ricarico_coefficiente) || num(r.ricarico_pct) || 0.5,
              scala_con_quantita: r.scala_con_quantita ?? true,
              tariffa_originale: originale,
              tariffa_cambiata: cambiato,
            };
          });

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

    // 5) Cliente (dal master)
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

    const codiceOrig = (doc as { codice: string | null }).codice ?? "preventivo";

    const docMeta = doc as {
      margine_trattativa_pct: number | null;
      consegna_settimane_min: number | null;
      consegna_settimane_max: number | null;
    };

    return NextResponse.json({
      titolo: `Copia di ${codiceOrig}`,
      cliente,
      margine_trattativa_pct: docMeta.margine_trattativa_pct,
      consegna_settimane_min: docMeta.consegna_settimane_min,
      consegna_settimane_max: docMeta.consegna_settimane_max,
      blocchi,
      avvisi: {
        articoli_aggiornati: articoliAggiornati,
        servizi_aggiornati: serviziAggiornati,
        articoli_non_trovati: articoliNonTrovati,
      },
    });
  } catch (error) {
    console.error("Duplica documento error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
