import { notFound } from "next/navigation";
import { CampagnaDettaglioView } from "@/components/portali/campagne/campagna-dettaglio-view";
import { ErroreCampagne, leggiCampagna } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";
import { IdUuid } from "@/lib/portali/campagne/risposte";

export const metadata = { title: "Campagna" };
export const dynamic = "force-dynamic";

export default async function CampagnaPage({ params }: { params: Promise<{ id: string }> }) {
  await richiediAdmin();
  const id = IdUuid.safeParse((await params).id);
  if (!id.success) notFound();

  try {
    return <CampagnaDettaglioView iniziale={await leggiCampagna(id.data)} />;
  } catch (e) {
    if (e instanceof ErroreCampagne && e.status === 404) notFound();
    throw e;
  }
}
