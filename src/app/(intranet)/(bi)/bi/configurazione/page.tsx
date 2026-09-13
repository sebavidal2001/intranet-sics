
import { ConfigurazioneView } from "@/components/prototipo-bi/configurazione-view";
import { ottieniSnapshot } from "@/lib/prototipo-bi/sorgente";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Budget & BEP — BI Direzionale",
};

export default async function PaginaConfigurazione() {
  let anno = new Date().getFullYear();
  try {
    const s = await ottieniSnapshot();
    if (s.dataMassima) anno = Number(s.dataMassima.slice(0, 4)) || anno;
  } catch {
    // Nessuno snapshot: si parte dall'anno di sistema.
  }
  return <ConfigurazioneView annoIniziale={anno} />;
}
