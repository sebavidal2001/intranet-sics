
import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, snapshotPerimetrato } from "../_comune";
import { dettaglioDocumenti, DATASET_DETTAGLIO } from "@/lib/prototipo-bi/dettaglio";
import { DIMENSIONI } from "@/lib/prototipo-bi/semantico";
import type { ChiaveDataset, Dimensione, Filtro } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";

/**
 * Elenco documenti e righe di un documento.
 *
 * Il perimetro resta chiuso come per le metriche: dataset e dimensioni sono
 * validati contro liste note, così questa rotta non diventa una scorciatoia
 * per leggere campi arbitrari.
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let body: {
    dataset?: string;
    filtri?: { campo?: string; op?: string; valore?: unknown }[];
    periodo?: { dal?: string; al?: string; anno?: number; anni?: number[] };
    documento?: string;
    limite?: number;
    ordina?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const dataset = String(body.dataset ?? "") as ChiaveDataset;
  if (!DATASET_DETTAGLIO.includes(dataset)) {
    return errore(
      `Dataset "${body.dataset}" senza dettaglio documentale. Disponibili: ${DATASET_DETTAGLIO.join(", ")}.`,
      422
    );
  }

  const filtri: Filtro[] = [];
  for (const f of body.filtri ?? []) {
    const campo = String(f.campo ?? "") as Dimensione;
    if (!DIMENSIONI[campo]) return errore(`Dimensione "${f.campo}" non esiste.`, 422);
    const op = String(f.op ?? "eq");
    if (!["eq", "neq", "in", "contiene"].includes(op)) {
      return errore(`Operatore "${op}" non valido.`, 422);
    }
    filtri.push({ campo, op: op as Filtro["op"], valore: f.valore as string | string[] });
  }

  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const esito = dettaglioDocumenti(
      {
        dataset,
        filtri,
        periodo: body.periodo,
        documento: body.documento ? String(body.documento).slice(0, 60) : undefined,
        limite: typeof body.limite === "number" ? body.limite : undefined,
        ordina:
          body.ordina === "data" || body.ordina === "eta" || body.ordina === "importo"
            ? body.ordina
            : undefined,
      },
      snapshot
    );
    return NextResponse.json({ ...esito, dataMassima: snapshot.dataMassima });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore dettaglio" },
      { status: 500 }
    );
  }
}
