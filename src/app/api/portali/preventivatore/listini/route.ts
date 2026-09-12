import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { logError, logInfo, logWarn, newRequestId } from "@/lib/logger";
import { validaEParsa, normalizzaCodice, TRACCIATI } from "@/lib/portali/preventivatore/listini";

export const dynamic = "force-dynamic";

/** Oltre questa dimensione il file non è un listino: evita upload accidentali. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Listini fornitore (migration 084/085).
 *
 * GET  /api/portali/preventivatore/listini
 *      Elenco dei listini caricati.
 *
 * POST /api/portali/preventivatore/listini   (solo admin, multipart/form-data)
 *      campi: `file` (Excel/CSV) + `fornitore` (chiave di TRACCIATI)
 *
 *      Il file viene letto e validato QUI, non nel browser: il client fa lo
 *      stesso controllo solo per mostrare l'anteprima, ma la decisione di
 *      accettare o rifiutare è del server. Un listino sbagliato non darebbe
 *      errore a valle — darebbe prezzi sbagliati in silenzio.
 *
 *      Risposta 422 con { problemi, log } se il file non corrisponde al
 *      tracciato del fornitore. Caricare un fornitore già presente disattiva il
 *      listino precedente, che resta a storico.
 */

export async function GET() {
  try {
    const guard = await requirePreventivatore("admin");
    if (!guard.ok) return guard.response;

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .select("id, fornitore, nome_file, colonne, righe_lette, righe_valide, attivo, note, validazione, caricato_il")
      .order("caricato_il", { ascending: false });

    if (error) {
      logError("preventivatore.listini", "Elenco listini error", error);
      return NextResponse.json({ error: "Errore recupero listini" }, { status: 500 });
    }

    return NextResponse.json({ listini: data ?? [] });
  } catch (error) {
    logError("preventivatore.listini", "Listini GET error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const reqId = newRequestId();
  try {
    const guard = await requirePreventivatore("admin");
    if (!guard.ok) return guard.response;

    // ── 1) Estrazione dei campi dalla form ────────────────────────────────────
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Richiesta non valida: attesa una form con il file del listino." },
        { status: 400 }
      );
    }

    const fornitore = String(form.get("fornitore") ?? "").trim().toUpperCase();
    const file = form.get("file");

    if (!fornitore) {
      logWarn("preventivatore.listini", "Caricamento senza fornitore", { reqId });
      return NextResponse.json(
        {
          error: "Non hai selezionato il fornitore.",
          problemi: [
            {
              gravita: "errore",
              codice: "fornitore_mancante",
              messaggio: "Non hai selezionato il fornitore.",
              azione: "Scegli il fornitore dall'elenco: ogni fornitore ha un formato di file diverso.",
            },
          ],
          log: [],
        },
        { status: 422 }
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "Nessun file ricevuto.",
          problemi: [
            {
              gravita: "errore",
              codice: "file_mancante",
              messaggio: "Nessun file ricevuto.",
              azione: "Trascina l'Excel del listino nell'area di caricamento.",
            },
          ],
          log: [],
        },
        { status: 422 }
      );
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: file.size === 0 ? "Il file è vuoto." : "Il file supera i 15 MB.",
          problemi: [
            {
              gravita: "errore",
              codice: "file_dimensione",
              messaggio: file.size === 0 ? "Il file è vuoto." : `Il file pesa ${(file.size / 1024 / 1024).toFixed(1)} MB, oltre il limite di 15 MB.`,
              azione: "Un listino non dovrebbe superare qualche MB: controlla di aver preso il file giusto.",
            },
          ],
          log: [],
        },
        { status: 422 }
      );
    }

    // ── 2) Lettura del foglio ────────────────────────────────────────────────
    let righe: unknown[][];
    let nomeFoglio: string | null = null;
    try {
      const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
      nomeFoglio = wb.SheetNames[0] ?? null;
      if (!nomeFoglio) throw new Error("nessun foglio");
      righe = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeFoglio], {
        header: 1,
        raw: true,
        defval: null,
      });
    } catch (e) {
      logWarn("preventivatore.listini", "File illeggibile", { reqId, fornitore, errore: String(e) });
      return NextResponse.json(
        {
          error: "File illeggibile.",
          problemi: [
            {
              gravita: "errore",
              codice: "file_illeggibile",
              messaggio: "Il file non è un foglio di calcolo leggibile.",
              azione: "Salvalo come .xlsx dal gestionale o da Excel e riprova.",
            },
          ],
          log: [],
        },
        { status: 422 }
      );
    }

    // ── 3) Validazione contro il tracciato del fornitore ─────────────────────
    const esito = validaEParsa(righe, fornitore, nomeFoglio);
    if (!esito.ok) {
      logWarn("preventivatore.listini", "Listino rifiutato dalla validazione", {
        reqId,
        fornitore,
        nomeFile: file.name,
        nomeFoglio,
        problemi: esito.problemi.filter((p) => p.gravita === "errore").map((p) => p.codice),
      });
      return NextResponse.json(
        {
          error: esito.problemi.find((p) => p.gravita === "errore")?.messaggio ?? "File non valido.",
          problemi: esito.problemi,
          log: esito.log,
        },
        { status: 422 }
      );
    }

    // ── 4) Salvataggio ───────────────────────────────────────────────────────
    const tracciato = TRACCIATI[fornitore]!;
    const perCodice = new Map<string, (typeof esito.voci)[number] & { codice_norm: string }>();
    for (const v of esito.voci) {
      const codice_norm = normalizzaCodice(v.codice);
      if (codice_norm) perCodice.set(codice_norm, { ...v, codice_norm });
    }

    const admin = createAdminClient();

    // Il nuovo listino nasce NON attivo: finché le voci non sono tutte dentro,
    // quello vecchio resta l'unico in vigore. Lo scambio avviene alla fine.
    const { data: listino, error: errIns } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .insert({
        fornitore,
        nome_file: file.name,
        colonne: {
          codice: tracciato.colonnaCodice,
          descrizione: tracciato.colonnaDescrizione,
          prezzo: tracciato.colonnaPrezzo,
          divisore: tracciato.divisore,
        },
        righe_lette: esito.righe_lette,
        righe_valide: perCodice.size,
        validazione: {
          nomeFoglio,
          log: esito.log,
          problemi: esito.problemi,
          righe_lette: esito.righe_lette,
          righe_scartate: esito.righe_scartate,
          codici_in_conflitto: esito.codici_in_conflitto.slice(0, 100),
        },
        caricato_da: guard.user.id,
        attivo: false,
      })
      .select("id")
      .single();

    if (errIns || !listino) {
      logError("preventivatore.listini", "Insert listino error", errIns, { reqId, fornitore });
      return NextResponse.json({ error: "Errore creazione listino" }, { status: 500 });
    }

    const voci = Array.from(perCodice.values()).map((v) => ({
      listino_id: listino.id,
      codice_norm: v.codice_norm,
      codice: v.codice.trim(),
      descrizione: v.descrizione ?? null,
      prezzo_origine: v.prezzo_origine,
      costo: v.costo,
      riga_file: v.riga_file,
    }));

    // Inserimento a blocchi: 2.000 voci in un colpo solo fanno timeout.
    const CHUNK = 500;
    for (let i = 0; i < voci.length; i += CHUNK) {
      const { error: errVoci } = await admin
        .schema("preventivatore")
        .from("listini_fornitore_voci")
        .insert(voci.slice(i, i + CHUNK));
      if (errVoci) {
        logError("preventivatore.listini", "Insert voci listino error", errVoci, { reqId, fornitore });
        // Il listino incompleto sparisce (cascade sulle voci già inserite) e
        // quello precedente, mai toccato, resta in vigore.
        await admin.schema("preventivatore").from("listini_fornitore").delete().eq("id", listino.id);
        return NextResponse.json({ error: "Errore salvataggio voci listino" }, { status: 500 });
      }
    }

    // Scambio: fuori il vecchio, dentro il nuovo (l'indice unico parziale
    // ammette un solo listino attivo per fornitore).
    const { error: errDisattiva } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .update({ attivo: false })
      .eq("attivo", true)
      .ilike("fornitore", fornitore);
    if (errDisattiva) {
      logError("preventivatore.listini", "Disattivazione listino precedente error", errDisattiva, { reqId });
      await admin.schema("preventivatore").from("listini_fornitore").delete().eq("id", listino.id);
      return NextResponse.json({ error: "Errore sostituzione listino" }, { status: 500 });
    }

    const { error: errAttiva } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .update({ attivo: true })
      .eq("id", listino.id);
    if (errAttiva) {
      logError("preventivatore.listini", "Attivazione nuovo listino error", errAttiva, { reqId });
      return NextResponse.json({ error: "Listino caricato ma non attivato" }, { status: 500 });
    }

    logInfo("preventivatore.listini", "Listino caricato e attivato", {
      reqId,
      fornitore,
      nomeFile: file.name,
      nomeFoglio,
      voci: voci.length,
      righeLette: esito.righe_lette,
      avvisi: esito.problemi.filter((p) => p.gravita === "avviso").map((p) => p.codice),
      utente: guard.user.id,
    });

    return NextResponse.json({
      id: listino.id,
      fornitore,
      voci_salvate: voci.length,
      log: esito.log,
      problemi: esito.problemi,
    });
  } catch (error) {
    logError("preventivatore.listini", "Listini POST error", error, { reqId });
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
