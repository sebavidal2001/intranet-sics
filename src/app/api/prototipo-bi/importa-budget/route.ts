/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore } from "../_comune";
import { importaBudget, unisciSerie } from "@/lib/prototipo-bi/importa-budget";
import {
  leggiSerieBudget,
  salvaSerieBudget,
  eliminaSerieBudget,
  anniConSerie,
} from "@/lib/prototipo-bi/archivio";
import type { SerieBudget } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTE = 15 * 1024 * 1024;

/** Riepilogo delle serie già importate. */
export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const anni = await anniConSerie();
  const serie = await Promise.all(
    anni.map(async (a) => {
      const s = await leggiSerieBudget(a);
      if (!s) return null;
      const aree = [...new Set(s.righe.filter((r) => !r.agente).map((r) => r.area))].sort();
      const agenti = [...new Set(s.righe.map((r) => r.agente).filter(Boolean))].sort();
      return {
        anno: a,
        origine: s.origine,
        formato: s.formato,
        importatoIl: s.importatoIl,
        righe: s.righe.length,
        budget: s.totaliPerAnno[a]?.budget ?? 0,
        bep: s.totaliPerAnno[a]?.bep ?? 0,
        aree,
        agenti,
      };
    })
  );

  return NextResponse.json({ serie: serie.filter(Boolean) });
}

/**
 * Import di uno o più file Excel (multipart).
 * I file per area e quelli per commerciale si uniscono: sono due livelli di
 * dettaglio dello stesso budget, non due budget da sommare.
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errore("Attesa una richiesta multipart con i file Excel");
  }

  const file = form.getAll("file").filter((f): f is File => f instanceof File);
  if (file.length === 0) return errore("Nessun file ricevuto");

  const sostituisci = form.get("sostituisci") === "1";
  const avvisi: string[] = [];
  const serieLette: SerieBudget[] = [];

  for (const f of file) {
    if (f.size > MAX_BYTE) {
      return errore(`"${f.name}" supera i 15 MB`, 413);
    }
    if (!/\.xlsx?$/i.test(f.name)) {
      avvisi.push(`"${f.name}" ignorato: non è un file Excel.`);
      continue;
    }
    try {
      const buffer = Buffer.from(await f.arrayBuffer());
      const esito = importaBudget(buffer);
      if (esito.serie.righe.length === 0) {
        avvisi.push(`"${f.name}": nessuna riga utilizzabile.`);
        continue;
      }
      serieLette.push(esito.serie);
      avvisi.push(
        `"${f.name}": ${esito.serie.righe.length} righe, formato ${esito.serie.formato}, ` +
          `anni ${esito.serie.anni.join(", ")}.`
      );
      avvisi.push(...esito.avvisi.map((a) => `"${f.name}": ${a}`));
    } catch (e) {
      return errore(
        `Errore leggendo "${f.name}": ${e instanceof Error ? e.message : "formato non valido"}`
      );
    }
  }

  if (serieLette.length === 0) {
    return errore("Nessun file valido: " + avvisi.join(" "));
  }

  // Si spezza per anno: ogni anno ha il suo file di serie.
  const anni = [...new Set(serieLette.flatMap((s) => s.anni))].sort();
  const salvati: { anno: number; righe: number; budget: number; bep: number }[] = [];

  for (const anno of anni) {
    const perAnno = serieLette.map((s) => ({
      ...s,
      righe: s.righe.filter((r) => Number(r.data.slice(0, 4)) === anno),
      anni: [anno],
    }));

    const daUnire = perAnno.filter((s) => s.righe.length > 0);
    if (daUnire.length === 0) continue;

    let nuova = unisciSerie(daUnire);

    if (!sostituisci) {
      const esistente = await leggiSerieBudget(anno);
      if (esistente) {
        // Si conserva ciò che il nuovo file non copre (es. si importa solo il
        // dettaglio commerciali su una base per area già presente).
        const chiaviNuove = new Set(
          nuova.righe.map((r) => `${r.data}|${r.area}|${r.agente ?? ""}`)
        );
        const superstiti = esistente.righe.filter(
          (r) => !chiaviNuove.has(`${r.data}|${r.area}|${r.agente ?? ""}`)
        );
        nuova = unisciSerie([
          { ...esistente, righe: superstiti },
          nuova,
        ]);
      }
    }

    await salvaSerieBudget(anno, nuova, pre.accesso.userId);
    salvati.push({
      anno,
      righe: nuova.righe.length,
      budget: nuova.totaliPerAnno[anno]?.budget ?? 0,
      bep: nuova.totaliPerAnno[anno]?.bep ?? 0,
    });
  }

  return NextResponse.json({ ok: true, salvati, avvisi });
}

/** Rimuove la serie importata di un anno (si torna alla generazione). */
export async function DELETE(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const anno = Number(request.nextUrl.searchParams.get("anno"));
  if (!Number.isFinite(anno)) return errore("Anno non valido");

  await eliminaSerieBudget(anno);
  return NextResponse.json({ ok: true });
}
