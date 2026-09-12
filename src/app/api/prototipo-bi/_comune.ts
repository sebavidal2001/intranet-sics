/**
 * Utilità condivise dalle route del BI.
 */

import { NextResponse } from "next/server";
import { prototipoConsentito, rispostaBloccata } from "@/lib/prototipo-bi/guardia";
import { verificaAccesso, AccessoNegato, type AccessoBi } from "@/lib/prototipo-bi/accesso";
import { ottieniSnapshot } from "@/lib/prototipo-bi/sorgente";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

export type EsitoPreliminare =
  | { ok: true; accesso: AccessoBi }
  | { ok: false; risposta: Response };

/** Guardia di ambiente + autenticazione, in un colpo solo. */
export async function preliminari(): Promise<EsitoPreliminare> {
  if (!prototipoConsentito()) {
    return { ok: false, risposta: rispostaBloccata() };
  }
  try {
    const accesso = await verificaAccesso();
    return { ok: true, accesso };
  } catch (e) {
    const status = e instanceof AccessoNegato ? 403 : 500;
    return {
      ok: false,
      risposta: NextResponse.json(
        { error: e instanceof Error ? e.message : "Errore" },
        { status }
      ),
    };
  }
}

/**
 * Lo snapshot che questo utente ha il diritto di vedere.
 *
 * **Ogni route che legge dati deve passare di qui, mai da `ottieniSnapshot`
 * diretto.** Quello che esce è un oggetto in cui le righe fuori perimetro non
 * esistono: qualunque cosa ci giri sopra — query certificate, rilevatori,
 * briefing, export, l'analista AI — è perimetrata di conseguenza, senza che
 * debba saperlo.
 *
 * Con perimetro aperto non c'è copia e non c'è costo.
 */
export async function snapshotPerimetrato(
  accesso: AccessoBi,
  forzaAggiornamento = false
): Promise<Snapshot> {
  const completo = await ottieniSnapshot(forzaAggiornamento);
  return applicaPerimetro(completo, accesso.perimetro);
}

export function errore(messaggio: string, status = 400) {
  return NextResponse.json({ error: messaggio }, { status });
}

/** Rifiuto standard quando il livello non basta per un'operazione. */
export function negato(messaggio: string) {
  return NextResponse.json({ error: messaggio }, { status: 403 });
}
