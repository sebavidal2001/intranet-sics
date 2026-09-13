/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, snapshotPerimetrato } from "../_comune";
import {
  leggiConfigurazione,
  pesiDaRiscontri,
  leggiBriefingArchiviati,
} from "@/lib/prototipo-bi/archivio";
import { distribuisci } from "@/lib/prototipo-bi/budget";
import { costruisciContesto, rilevaTutto, calcolaPunteggi } from "@/lib/prototipo-bi/rilevatori";
import { generaBriefing } from "@/lib/prototipo-bi/analista";
import {
  esportaBudgetExcel,
  esportaTabelleExcel,
  generaReportWord,
} from "@/lib/prototipo-bi/documenti/genera";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import { eseguiSqlBi, validaSqlSolaLettura } from "@/lib/prototipo-bi/sql";
import type { SpecQuery } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function nomeFile(base: string, estensione: string) {
  const oggi = new Date().toISOString().slice(0, 10);
  return `PROTOTIPO_${base}_${oggi}.${estensione}`;
}

function rispostaFile(buffer: Buffer, nome: string, tipo: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Body:
 *  { tipo: "budget-excel", anno }
 *  { tipo: "query-excel", blocchi: [{ titolo, spec }] }
 *  { tipo: "report-word", approfondimenti?: [{ titolo, spec }], commento? }
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let body: {
    tipo?: string;
    anno?: number;
    blocchi?: { titolo: string; spec?: unknown; sql?: unknown }[];
    approfondimenti?: { titolo: string; spec?: unknown; sql?: unknown }[];
    commento?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  try {
    if (body.tipo === "budget-excel") {
      const anno = Number(body.anno) || new Date().getFullYear();
      const config = await leggiConfigurazione(anno);
      if (!config) return errore(`Nessuna configurazione per il ${anno}`, 404);
      const buffer = esportaBudgetExcel(config, distribuisci(config));
      return rispostaFile(buffer, nomeFile(`Budget_BEP_${anno}`, "xlsx"), XLSX_MIME);
    }

    const snapshot = await snapshotPerimetrato(pre.accesso);

    if (body.tipo === "query-excel") {
      const blocchi = await Promise.all((body.blocchi ?? []).map(async (b) => {
        const titolo = String(b.titolo ?? "Dati").slice(0, 60);
        if (typeof b.sql === "string" && b.sql.trim()) {
          const risultato = await eseguiSqlBi(b.sql, 500);
          return { titolo, righe: risultato.righe, natura: "SQL esplorativo di sola lettura" };
        }
        const spec = validaSpec(b.spec) as SpecQuery;
        const risultato = esegui(spec, snapshot);
        return {
          titolo,
          natura: "Metrica certificata",
          righe: risultato.righe.map((r) => ({ ...r.chiavi, Voce: r.etichetta, Valore: r.valore, Righe: r.conteggio })),
        };
      }));
      if (blocchi.length === 0) return errore("Nessun blocco da esportare");
      const buffer = esportaTabelleExcel(blocchi, snapshot);
      return rispostaFile(buffer, nomeFile("Estrazione_BI", "xlsx"), XLSX_MIME);
    }

    if (body.tipo === "report-word") {
      const anno = Number((snapshot.dataMassima ?? "").slice(0, 4)) || new Date().getFullYear();
      const config = await leggiConfigurazione(anno);
      const ctx = costruisciContesto(snapshot, config, pre.accesso.agenteScope);

      const archiviati = await leggiBriefingArchiviati();
      const idGiaVisti = new Set(
        archiviati.slice(0, 3).flatMap((b) => b.voci.map((v) => v.segnaleId))
      );
      const ordinati = calcolaPunteggi(rilevaTutto(ctx), {
        idGiaVisti,
        pesiFamiglia: await pesiDaRiscontri(),
      });

      const briefing = await generaBriefing({
        segnali: ordinati,
        snapshot,
        destinatario: pre.accesso.nome,
        ruolo: pre.accesso.ruolo,
        massimoVoci: 3,
      });

      const approfondimenti: { titolo: string; spec: SpecQuery }[] = [];
      const approfondimentiSql: { titolo: string; righe: Record<string, unknown>[] }[] = [];
      for (const a of body.approfondimenti ?? []) {
        const titolo = String(a.titolo ?? "Approfondimento").slice(0, 80);
        if (typeof a.sql === "string" && a.sql.trim()) {
          const sql = validaSqlSolaLettura(a.sql);
          approfondimentiSql.push({ titolo, righe: (await eseguiSqlBi(sql, 100)).righe });
        } else {
          approfondimenti.push({ titolo, spec: validaSpec(a.spec) as SpecQuery });
        }
      }

      const buffer = await generaReportWord({
        briefing,
        snapshot,
        approfondimenti,
        approfondimentiSql,
        commento: body.commento?.slice(0, 4000) ?? null,
      });
      return rispostaFile(buffer, nomeFile("Report_Direzionale", "docx"), DOCX_MIME);
    }

    return errore(`Tipo di esportazione sconosciuto: "${body.tipo}"`);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore esportazione" },
      { status: 500 }
    );
  }
}
