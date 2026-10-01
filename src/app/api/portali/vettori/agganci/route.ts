import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { puoGestire, VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import {
  applicaAggancio,
  dettaglioAggancio,
  proponiPerRiga,
  scartaAggancio,
} from "@/lib/portali/vettori/aggancio-ai";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Aggancio di una riga di fattura gia' in archivio alla sua bolla.
 *
 * GET  ?riga=<id>   proposta del modello (se gia' pagata) e bolle candidate.
 * POST { riga, azione: "conferma", spedizione }   aggancia e rifa' il controllo
 *      { riga, azione: "nessuna" }                chiude la proposta, non aggancia
 *      { riga, azione: "proponi" }                chiede la proposta al modello
 *
 * Guardare e' di chi vede gli importi; decidere e' dell'amministrazione, come
 * le anomalie: un aggancio congela la bolla e cambia il controllo.
 */

const Riga = z.string().uuid();

const Corpo = z.discriminatedUnion("azione", [
  z.object({ azione: z.literal("conferma"), riga: Riga, spedizione: z.string().uuid() }).strict(),
  z.object({ azione: z.literal("nessuna"), riga: Riga }).strict(),
  z.object({ azione: z.literal("proponi"), riga: Riga }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione, VETTORI_RUOLI.direzione] });
    if (!guard.ok) return guard.response;
    const riga = Riga.safeParse(request.nextUrl.searchParams.get("riga"));
    if (!riga.success) return NextResponse.json({ error: "Riga non valida." }, { status: 400 });

    const dettaglio = await dettaglioAggancio(riga.data);
    if (!dettaglio) {
      return NextResponse.json({ error: "La riga è già agganciata o non esiste." }, { status: 404 });
    }
    return NextResponse.json({ ...dettaglio, puoDecidere: puoGestire(guard.ctx) });
  } catch (error) {
    logError("vettori.agganci", "lettura aggancio fallita", error);
    return NextResponse.json({ error: "Non è stato possibile leggere le bolle candidate." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;

    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }
    const parsed = Corpo.safeParse(corpo);
    if (!parsed.success) return NextResponse.json({ error: "Dati non validi." }, { status: 400 });
    const c = parsed.data;

    if (c.azione === "conferma") {
      try {
        const esito = await applicaAggancio(c.riga, c.spedizione, guard.user.id);
        return NextResponse.json({ agganciata: true, ...esito });
      } catch (e) {
        // Gli errori della funzione SQL sono gia' frasi per chi usa il portale.
        return NextResponse.json({ error: e instanceof Error ? e.message : "Aggancio non riuscito." }, { status: 409 });
      }
    }
    if (c.azione === "nessuna") {
      await scartaAggancio(c.riga, guard.user.id);
      return NextResponse.json({ scartata: true });
    }
    const proposta = await proponiPerRiga(c.riga);
    if (!proposta) {
      return NextResponse.json({ error: "La riga è già agganciata o non esiste." }, { status: 404 });
    }
    return NextResponse.json({ proposta: { esito: proposta.esito, spedizioneId: proposta.spedizioneId, sicurezza: proposta.sicurezza, motivo: proposta.motivo } });
  } catch (error) {
    logError("vettori.agganci", "operazione di aggancio fallita", error);
    return NextResponse.json({ error: "Operazione non riuscita." }, { status: 500 });
  }
}
