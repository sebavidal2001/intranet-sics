/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { CruscottoView } from "@/components/prototipo-bi/cruscotto-view";
import { ottieniSnapshot } from "@/lib/prototipo-bi/sorgente";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cruscotto — Prototipo BI (non in produzione)",
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
