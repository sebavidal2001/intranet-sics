/**
 * La route rende raggiungibili le analisi salvate senza dipendere da una
 * dashboard specifica o dalla conoscenza dell'indirizzo dell'editor.
 */

import { AnalisiList } from "@/components/prototipo-bi/analisi-list";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analisi — BI Direzionale",
};

export default function PaginaAnalisi() {
  return <AnalisiList />;
}
