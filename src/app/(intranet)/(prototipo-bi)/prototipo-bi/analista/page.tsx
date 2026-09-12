/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { AnalistaView } from "@/components/prototipo-bi/analista-view";
import { ottieniSnapshot } from "@/lib/prototipo-bi/sorgente";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analista — Prototipo BI (non in produzione)",
};

export default async function PaginaAnalista() {
  let dataMinima: string | null = null;
  let dataMassima: string | null = null;
  try {
    const s = await ottieniSnapshot();
    dataMinima = s.dataMinima;
    dataMassima = s.dataMassima;
  } catch {
    // La pagina resta usabile anche se lo snapshot non è ancora stato costruito.
  }
  return <AnalistaView dataMinima={dataMinima} dataMassima={dataMassima} />;
}
