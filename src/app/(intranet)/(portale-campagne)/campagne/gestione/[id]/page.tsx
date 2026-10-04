import { notFound } from "next/navigation";
import { CampagnaDettaglioView } from "@/components/portali/campagne/campagna-dettaglio-view";
import { ErroreCampagne, leggiCampagna, pubbliciPerScelta } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";
import { IdUuid } from "@/lib/portali/campagne/risposte";

export const metadata = { title: "Campagna" };
export const dynamic = "force-dynamic";

export default async function CampagnaPage({ params }: { params: Promise<{ id: string }> }) {
  await richiediAdmin();
  const id = IdUuid.safeParse((await params).id);
  if (!id.success) notFound();

  try {
    const [campagna, pubblici] = await Promise.all([leggiCampagna(id.data), pubbliciPerScelta()]);
    return <CampagnaDettaglioView iniziale={campagna} pubblici={pubblici} />;
  } catch (e) {
    if (e instanceof ErroreCampagne && e.status === 404) notFound();
    throw e;
  }
}
