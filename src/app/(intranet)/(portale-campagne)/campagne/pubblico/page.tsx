import { PubblicoStandardView } from "@/components/portali/campagne/pubblico-standard-view";
import { leggiPubblicoStandard } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";

export const metadata = { title: "Pubblico standard" };
export const dynamic = "force-dynamic";

export default async function PubblicoStandardPage() {
  await richiediAdmin();
  return <PubblicoStandardView iniziale={await leggiPubblicoStandard()} />;
}
