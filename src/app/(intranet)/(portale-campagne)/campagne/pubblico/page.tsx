import { PubbliciElencoView } from "@/components/portali/campagne/pubblici-elenco-view";
import { elencoPubblici } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";

export const metadata = { title: "Pubblici" };
export const dynamic = "force-dynamic";

export default async function PubbliciPage() {
  await richiediAdmin();
  return <PubbliciElencoView iniziale={await elencoPubblici()} />;
}
