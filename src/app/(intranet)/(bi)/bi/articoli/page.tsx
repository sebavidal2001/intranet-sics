/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { ArticoliAcquistiView } from "@/components/prototipo-bi/articoli-acquisti-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Articoli & Acquisti — Prototipo BI (non in produzione)",
};

export default function PaginaArticoliAcquisti() {
  return <ArticoliAcquistiView />;
}
