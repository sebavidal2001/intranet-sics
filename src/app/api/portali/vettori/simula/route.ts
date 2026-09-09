import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { calcolaCostoAtteso } from "@/lib/portali/vettori/calcolo";
import {
  descriviListino,
  elencoVettori,
  risolviListino,
} from "@/lib/portali/vettori/listino-service";
import type { CondizioneSpedizione, CostoAtteso } from "@/lib/portali/vettori/tipi";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const CONDIZIONI = [
  "bancale",
  "non_sovrapponibile",
  "movimentazione_manuale",
  "oversized",
  "ztl",
  "etichetta_manuale",
  "triangolazione",
  "fuori_provincia",
  "giacenza",
  "assegno",
] as const;

const Body = z.object({
  colli: z.number().int().min(1).max(999).default(1),
  pesoKg: z.number().min(0).max(100_000),
  lunghezzaCm: z.number().min(0).max(2000).nullable().optional(),
  larghezzaCm: z.number().min(0).max(2000).nullable().optional(),
  altezzaCm: z.number().min(0).max(2000).nullable().optional(),
  provincia: z.string().trim().max(2).nullable().optional(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  condizioni: z.array(z.enum(CONDIZIONI)).default([]),
});

export interface RisultatoSimulazione {
  vettoreId: string;
  vettoreCodice: string;
  vettoreNome: string;
  disponibile: boolean;
  motivoIndisponibilita?: string;
  listino?: { etichetta: string; validoDal: string; validoAl: string | null } | null;
  calcolo?: CostoAtteso;
  /** Differenza in euro rispetto alla soluzione più conveniente. */
  differenzaDalMigliore?: number;
}

/**
 * POST /api/portali/vettori/simula
 *
 * Calcola il costo pieno di una spedizione su tutti i vettori a nostro carico e
 * li ordina dal più conveniente. Non crea niente: è una domanda, non un impegno.
 *
 * Chi non copre la destinazione compare comunque, con il motivo — è
 * un'informazione utile quanto il prezzo, e l'alternativa (farlo sparire) è il
 * modo migliore per far credere che quel vettore non sia stato considerato.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori();
    if (!guard.ok) return guard.response;

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const b = parsed.data;
    const data = b.data ? new Date(`${b.data}T12:00:00Z`) : new Date();
    const provincia = b.provincia ? b.provincia.toUpperCase() : null;

    const vettori = await elencoVettori(true);
    if (vettori.length === 0) {
      return NextResponse.json(
        { error: "Nessun vettore configurato" },
        { status: 409 }
      );
    }

    const dati = {
      colli: b.colli,
      pesoReale: b.pesoKg,
      lunghezzaCm: b.lunghezzaCm ?? null,
      larghezzaCm: b.larghezzaCm ?? null,
      altezzaCm: b.altezzaCm ?? null,
      condizioni: b.condizioni as CondizioneSpedizione[],
    };

    const risultati: RisultatoSimulazione[] = await Promise.all(
      vettori.map(async (v): Promise<RisultatoSimulazione> => {
        const { listino, motivo } = await risolviListino({
          vettoreId: v.id,
          data,
          provincia,
        });
        if (!listino) {
          return {
            vettoreId: v.id,
            vettoreCodice: v.codice,
            vettoreNome: v.nome,
            disponibile: false,
            motivoIndisponibilita: motivo ?? "Listino non disponibile.",
          };
        }
        const calcolo = calcolaCostoAtteso(dati, listino);
        const senzaFascia = calcolo.totale === 0 && calcolo.nolo === 0;
        return {
          vettoreId: v.id,
          vettoreCodice: v.codice,
          vettoreNome: v.nome,
          disponibile: !senzaFascia,
          motivoIndisponibilita: senzaFascia ? calcolo.avvertenze[0] : undefined,
          listino: await descriviListino(v.id, data),
          calcolo,
        };
      })
    );

    const disponibili = risultati
      .filter((r) => r.disponibile && r.calcolo)
      .sort((a, b2) => a.calcolo!.totale - b2.calcolo!.totale);
    const migliore = disponibili[0]?.calcolo?.totale ?? 0;
    for (const r of disponibili) {
      r.differenzaDalMigliore =
        Math.round((r.calcolo!.totale - migliore) * 100) / 100;
    }

    const nonDisponibili = risultati.filter((r) => !r.disponibile);

    return NextResponse.json({
      data: data.toISOString().slice(0, 10),
      provincia,
      risultati: [...disponibili, ...nonDisponibili],
    });
  } catch (e) {
    logError("vettori.simula", "simulazione fallita", e);
    return NextResponse.json({ error: "Errore nella simulazione" }, { status: 500 });
  }
}
