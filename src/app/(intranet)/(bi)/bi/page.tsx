import { redirect } from "next/navigation";
import { BriefingView } from "@/components/prototipo-bi/briefing-view";
import { verificaAccessoSicuro } from "@/lib/prototipo-bi/accesso";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Briefing — Statistiche BI",
};

export default async function PaginaBriefing() {
  // La tessera del portale porta qui. Chi riceve solo dashboard assegnate non
  // ha il Briefing: lo mandiamo alle sue dashboard invece di mostrargli un avviso
  // che sembra un "accesso negato".
  const esito = await verificaAccessoSicuro();
  if (esito.ok && esito.accesso.soloAssegnate) redirect("/bi/dashboard");

  return <BriefingView />;
}
