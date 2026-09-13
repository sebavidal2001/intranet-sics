/**
 * Il Cruscotto storico, e per ora l'unico completo.
 *
 * L'unificazione con le dashboard è a metà strada, di proposito. Le sue sei
 * schede sono state dichiarate come pagine in `cruscotto-predefinito.ts` e la
 * dashboard di sistema le riproduce, ma solo per i **14 riquadri esprimibili
 * come una singola SpecQuery**.
 *
 * Tutto il resto — i KPI con confronto, gli scostamenti, l'imbuto di
 * conversione, le tabelle analitiche — nasce dalla combinazione di due o tre
 * query, e il modello attuale "un riquadro = una spec" non lo rappresenta. Far
 * redirigere questo indirizzo alla dashboard, come previsto dal piano, avrebbe
 * tolto all'utente la maggior parte di ciò che guarda ogni giorno.
 *
 * Questa pagina resta quindi al suo posto finché un riquadro non potrà portare
 * più spec con un ruolo (principale, confronto, obiettivo) — che è la stessa
 * forma che `GraficoLinee` e `GraficoCombo` già accettano.
 */

import { CruscottoView } from "@/components/prototipo-bi/cruscotto-view";
import { ottieniSnapshot } from "@/lib/prototipo-bi/sorgente";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cruscotto — BI Direzionale",
};

export default async function PaginaCruscotto() {
  let anni: number[] = [new Date().getFullYear()];
  let bu: string[] = [];
  let agenti: string[] = [];
  let dataMassima: string | null = null;
  let runRicevutoIl: string | null = null;
  let tassonomiaBu: { coerente: boolean; estranei: string[] } | null = null;

  try {
    const s = await ottieniSnapshot();
    dataMassima = s.dataMassima;
    runRicevutoIl = s.runRicevutoIl;
    tassonomiaBu = s.tassonomiaBu ?? null;

    const righe = s.dataset.ordinato;
    anni = [...new Set(righe.map((r) => Number(r.data.slice(0, 4))).filter(Boolean))].sort(
      (a, b) => b - a
    );
    bu = [...new Set(righe.map((r) => r.bu))].filter(Boolean).sort();
    agenti = [...new Set(righe.map((r) => r.agente))].filter(Boolean).sort();
  } catch {
    // Snapshot non disponibile: il cruscotto mostrerà lo stato di errore.
  }

  return (
    <CruscottoView
      anniDisponibili={anni.length > 0 ? anni : [new Date().getFullYear()]}
      buDisponibili={bu}
      agentiDisponibili={agenti}
      dataMassima={dataMassima}
      runRicevutoIl={runRicevutoIl}
      tassonomiaBu={tassonomiaBu}
    />
  );
}
