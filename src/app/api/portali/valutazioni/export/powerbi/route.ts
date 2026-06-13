import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ExportRow } from "@/lib/types";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verifica autenticazione
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Verifica che sia admin
    const isAdmin = await isValutazioniAdmin(supabase, user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    // Parametri query (opzionali)
    const searchParams = request.nextUrl.searchParams;
    const anno = searchParams.get("anno");
    const reparto = searchParams.get("reparto");

    // 1. Carica tutto in parallelo: parametri + utenti + sessioni
    let utentiQuery = supabase
      .from("utenti")
      .select("id, nome, cognome, email, reparto");
    if (reparto) utentiQuery = utentiQuery.eq("reparto", reparto);

    let sessioniQuery = supabase.from("sessioni_valutazione").select("id, anno");
    if (anno) sessioniQuery = sessioniQuery.eq("anno", parseInt(anno));

    const [parametriRes, utentiRes, sessioniRes] = await Promise.all([
      supabase.from("parametri_radar").select("id, nome").eq("is_storico", false),
      utentiQuery,
      sessioniQuery,
    ]);

    const parametri = parametriRes.data;
    const utenti = utentiRes.data;
    const sessioni = sessioniRes.data;

    if (!parametri || parametri.length === 0) {
      return NextResponse.json({ error: "Parametri non trovati" }, { status: 404 });
    }
    if (!utenti || utenti.length === 0) {
      return NextResponse.json({ error: "Nessun utente trovato" }, { status: 404 });
    }
    if (!sessioni || sessioni.length === 0) {
      return NextResponse.json({ error: "Nessuna sessione trovata" }, { status: 404 });
    }

    const sessioneIds = sessioni.map((s) => s.id);
    const utenteIds = utenti.map((u) => u.id);

    // 2. Carica in bulk domande e risposte (2 query invece di N*M*P query)
    const [domandeRes, risposteRes] = await Promise.all([
      supabase
        .from("domande")
        .select("id, sessione_id, parametro_id")
        .in("sessione_id", sessioneIds),
      supabase
        .from("risposte")
        .select("domanda_id, utente_id, tipo, punteggio")
        .in("utente_id", utenteIds),
    ]);

    const tutteDomande = domandeRes.data ?? [];
    const tutteRisposte = risposteRes.data ?? [];

    // 3. Costruisci lookup maps in memoria (zero query aggiuntive)

    // domande per sessione+parametro: (sessione_id, parametro_id) → domanda[]
    const domandePerSessioneParametro = new Map<string, string[]>();
    for (const d of tutteDomande) {
      const key = `${d.sessione_id}:${d.parametro_id}`;
      const existing = domandePerSessioneParametro.get(key);
      if (existing) existing.push(d.id);
      else domandePerSessioneParametro.set(key, [d.id]);
    }

    // risposte per utente+tipo: (utente_id, tipo, domanda_id) → punteggio
    // Usiamo Map<string, number[]> dove key = `${utente_id}:${tipo}:${domanda_id}`
    const risposteMap = new Map<string, number>();
    for (const r of tutteRisposte) {
      risposteMap.set(`${r.utente_id}:${r.tipo}:${r.domanda_id}`, r.punteggio ?? 0);
    }

    // 4. Costruisci dataset flat completamente in memoria
    const exportData: ExportRow[] = [];

    for (const utente of utenti) {
      for (const sessione of sessioni) {
        for (const parametro of parametri) {
          const domandaIds = domandePerSessioneParametro.get(`${sessione.id}:${parametro.id}`);
          if (!domandaIds || domandaIds.length === 0) continue;

          let sumAuto = 0;
          let countAuto = 0;
          let sumResp = 0;
          let countResp = 0;

          for (const did of domandaIds) {
            const auto = risposteMap.get(`${utente.id}:autovalutazione:${did}`);
            if (auto !== undefined) { sumAuto += auto; countAuto++; }
            const resp = risposteMap.get(`${utente.id}:responsabile:${did}`);
            if (resp !== undefined) { sumResp += resp; countResp++; }
          }

          if (countAuto === 0 && countResp === 0) continue;

          const punteggioAuto = countAuto > 0 ? sumAuto / countAuto : 0;
          const punteggioResp = countResp > 0 ? sumResp / countResp : 0;
          const delta =
            punteggioResp > 0 && punteggioAuto > 0
              ? ((punteggioResp - punteggioAuto) / punteggioAuto) * 100
              : 0;

          exportData.push({
            anno: sessione.anno,
            utente_email: utente.email,
            utente_nome: utente.nome,
            utente_cognome: utente.cognome,
            reparto: utente.reparto,
            parametro: parametro.nome,
            punteggio_auto: Math.round(punteggioAuto * 10) / 10,
            punteggio_responsabile: Math.round(punteggioResp * 10) / 10,
            delta: Math.round(delta * 10) / 10,
          });
        }
      }
    }

    if (exportData.length === 0) {
      return NextResponse.json({ error: "Nessun dato da esportare" }, { status: 404 });
    }

    // 5. Converti in CSV
    const headers = [
      "anno",
      "utente_email",
      "utente_nome",
      "utente_cognome",
      "reparto",
      "parametro",
      "punteggio_auto",
      "punteggio_responsabile",
      "delta",
    ];

    const csvRows = [
      headers.join(","),
      ...exportData.map((row) =>
        headers
          .map((header) => {
            const value = row[header as keyof ExportRow];
            return typeof value === "string" ? `"${value}"` : value;
          })
          .join(",")
      ),
    ];

    return new NextResponse(csvRows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="export-powerbi-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    logError("valutazioni.export.powerbi", "Export error", error);
    return NextResponse.json({ error: "Errore durante l'export" }, { status: 500 });
  }
}
