/**
 * Utilità condivise dalle route del BI.
 */

import { NextResponse } from "next/server";
import { verificaAccesso, AccessoNegato, type AccessoBi } from "@/lib/prototipo-bi/accesso";
import { ottieniSnapshot } from "@/lib/prototipo-bi/sorgente";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import { leggiConfigurazione, leggiSerieBudget } from "@/lib/prototipo-bi/archivio";
import { serieDaConfigurazione } from "@/lib/prototipo-bi/budget-fonte";
import { CacheRisultati } from "@/lib/prototipo-bi/cache";
import type { SerieBudget, Snapshot } from "@/lib/prototipo-bi/tipi";

export type EsitoPreliminare =
  | { ok: true; accesso: AccessoBi }
  | { ok: false; risposta: Response };

/**
 * Autenticazione e livello sul portale `bi`.
 *
 * Non c'è più una guardia d'ambiente: l'accesso è quello del portale, deciso
 * dal superadmin utente per utente. Una barriera in più sarebbe una barriera
 * in più da ricordarsi di togliere, e intanto bloccherebbe anche chi è
 * legittimamente abilitato.
 */
export async function preliminari(): Promise<EsitoPreliminare> {
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
/**
 * Serie budget/BEP per anno.
 *
 * Due fonti, nell'ordine: il file importato dagli Excel aziendali, altrimenti
 * la distribuzione generata dagli importi annuali configurati. Se non c'e' ne'
 * l'uno ne' gli altri resta `null`, e chi chiede il budget si sente rispondere
 * che non c'e' — non gli viene servito un altro numero al suo posto.
 *
 * In cache dieci minuti: sono migliaia di righe per anno e cambiano quando
 * qualcuno importa un file, non a ogni richiesta.
 */
const cacheSerieBudget = new CacheRisultati<SerieBudget | null>(12, 10 * 60 * 1000);

async function serieBudgetAnno(anno: number): Promise<SerieBudget | null> {
  return cacheSerieBudget.ottieni(`serie:${anno}`, async () => {
    const importata = await leggiSerieBudget(anno);
    if (importata) return importata;
    const config = await leggiConfigurazione(anno);
    return config && config.budgetAnnuo > 0 ? serieDaConfigurazione(config) : null;
  });
}

/**
 * Anni da coprire: quelli presenti nei dati, piu' l'anno prima del primo —
 * serve ai confronti anno su anno, che spostano il bersaglio indietro di uno.
 */
function anniDaCoprire(snapshot: Snapshot): number[] {
  const corrente = new Date().getFullYear();
  const max = Number((snapshot.dataMassima ?? "").slice(0, 4)) || corrente;
  const min = Number((snapshot.dataMinima ?? "").slice(0, 4)) || max;
  const anni: number[] = [];
  for (let a = Math.min(min, corrente) - 1; a <= Math.max(max, corrente); a += 1) anni.push(a);
  return anni;
}

export async function snapshotPerimetrato(
  accesso: AccessoBi,
  forzaAggiornamento = false
): Promise<Snapshot> {
  const completo = await ottieniSnapshot(forzaAggiornamento);
  const perimetrato = applicaPerimetro(completo, accesso.perimetro);

  // Il budget viaggia con lo snapshot per lo stesso motivo del perimetro:
  // `esegui()` e' chiamata da decine di punti, e l'unico modo perche' tutti
  // ottengano il BEP vero e' che il BEP sia gia' li' dentro quando arrivano.
  const anni = anniDaCoprire(perimetrato);
  const serie = await Promise.all(anni.map((a) => serieBudgetAnno(a)));
  const serieBudget: Record<number, SerieBudget | null> = {};
  anni.forEach((a, i) => {
    serieBudget[a] = serie[i];
  });

  return { ...perimetrato, serieBudget };
}

export function errore(messaggio: string, status = 400) {
  return NextResponse.json({ error: messaggio }, { status });
}

/** Rifiuto standard quando il livello non basta per un'operazione. */
export function negato(messaggio: string) {
  return NextResponse.json({ error: messaggio }, { status: 403 });
}
