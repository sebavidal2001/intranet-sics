import { notFound } from "next/navigation";
import { PubblicoView } from "@/components/portali/campagne/pubblico-view";
import { ErroreCampagne, leggiPubblico } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";
import { IdUuid } from "@/lib/portali/campagne/risposte";

export const metadata = { title: "Pubblico" };
export const dynamic = "force-dynamic";

export default async function PubblicoPage({ params }: { params: Promise<{ id: string }> }) {
  await richiediAdmin();
  const id = IdUuid.safeParse((await params).id);
  if (!id.success) notFound();

  try {
    // `key`: passando da un pubblico all'altro la schermata riparte da zero, senza ereditare le scelte del precedente.
    return <PubblicoView key={id.data} iniziale={await leggiPubblico(id.data)} />;
  } catch (e) {
    if (e instanceof ErroreCampagne && e.status === 404) notFound();
    throw e;
  }
}
