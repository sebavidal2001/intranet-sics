import Link from "next/link";
import { notFound } from "next/navigation";
import { SchedaClienteView } from "@/components/portali/campagne/scheda-cliente-view";
import { ErroreCampagne } from "@/lib/portali/campagne/dati";
import { schedaClienteCompleta } from "@/lib/portali/campagne/impresa";
import { richiediOperatore } from "@/lib/portali/campagne/pagine";
import { oggiRoma } from "@/lib/portali/campagne/stati";

export const metadata = { title: "Scheda cliente" };
export const dynamic = "force-dynamic";

/** Scheda cliente: storico, azione suggerita e modulo di assegnazione. */
export default async function SchedaClientePage({ params }: { params: Promise<{ codice: string }> }) {
  await richiediOperatore();
  const { codice } = await params;

  let scheda;
  try {
    scheda = await schedaClienteCompleta(decodeURIComponent(codice));
  } catch (e) {
    if (e instanceof ErroreCampagne && e.status === 404) notFound();
    throw e;
  }

  const oggi = oggiRoma();
  return (
    <div>
      <Link href="/campagne" className="mb-4 inline-block text-sm text-primary hover:underline">
        ← Cerca un altro cliente
      </Link>
      <SchedaClienteView scheda={scheda} annoCorrente={Number(oggi.slice(0, 4))} oggi={oggi} />
    </div>
  );
}
