import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { vedeImporti } from "@/lib/portali/vettori/ruoli";
import { elencoSpedizioni, versoCsv } from "@/lib/portali/vettori/storico";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Filtri = z.object({
  direzione: z.enum(["entrata", "uscita"]).nullable().optional(),
  vettori: z.array(z.string().trim().min(1)).max(20).optional(),
  da: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  anno: z.number().int().min(2000).max(2100).nullable().optional(),
  mese: z.number().int().min(1).max(12).nullable().optional(),
  esiti: z
    .array(z.enum(["in_linea", "da_verificare", "anomalia", "non_valutabile"]))
    .max(4)
    .optional(),
  abbinamenti: z
    .array(z.enum(["numero", "assistito", "manuale", "nessuno"]))
    .max(4)
    .optional(),
  province: z.array(z.string().trim().length(2)).max(110).optional(),
  cerca: z.string().trim().max(120).nullable().optional(),
  soloAnomalie: z.boolean().optional(),
  pesoMin: z.number().min(0).max(100_000).nullable().optional(),
  pesoMax: z.number().min(0).max(100_000).nullable().optional(),
  importoMin: z.number().min(0).max(1_000_000).nullable().optional(),
  importoMax: z.number().min(0).max(1_000_000).nullable().optional(),
  scostamentoMin: z.number().min(0).max(100).nullable().optional(),
  ordine: z
    .enum(["data_desc", "data_asc", "importo_desc", "importo_asc", "scostamento_desc", "peso_desc"])
    .optional(),
  pagina: z.number().int().min(1).max(10_000).optional(),
  perPagina: z.number().int().min(10).max(500).optional(),
  /** Con `csv` la risposta è il file invece dell'elenco. */
  formato: z.enum(["json", "csv"]).optional(),
});

/**
 * POST /api/portali/vettori/spedizioni
 *
 * I filtri viaggiano nel corpo e non in query string: sono una quindicina, con
 * liste e intervalli, e una URL con `province[]=...` ripetuto novanta volte non
 * è né leggibile né sotto il limite di lunghezza di tutti i proxy.
 *
 * L'export CSV passa dalla stessa funzione con gli stessi filtri, così il file
 * scaricato contiene esattamente le righe che si vedevano a schermo — e non un
 * insieme che assomiglia a quello.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori();
    if (!guard.ok) return guard.response;

    // Lo storico è fatto di importi: chi non li vede non ha motivo di aprirlo.
    if (!vedeImporti(guard.ctx)) {
      return NextResponse.json(
        { error: "Il tuo ruolo non prevede la consultazione degli importi." },
        { status: 403 }
      );
    }

    const parsed = Filtri.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Filtri non validi", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { formato, ...filtri } = parsed.data;

    if (formato === "csv") {
      // L'export non pagina: chi scarica vuole tutto quello che ha filtrato.
      const tutto = await elencoSpedizioni({ ...filtri, pagina: 1, perPagina: 500 });
      const csv = versoCsv(tutto.righe);
      const parte = filtri.direzione === "entrata" ? "arrivi" : filtri.direzione === "uscita" ? "partenze" : "spedizioni";
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${parte}-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(await elencoSpedizioni(filtri));
  } catch (e) {
    logError("vettori.spedizioni", "lettura storico fallita", e);
    return NextResponse.json(
      { error: "Errore nella lettura dello storico." },
      { status: 500 }
    );
  }
}
