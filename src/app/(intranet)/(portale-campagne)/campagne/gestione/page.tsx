import { GestioneCampagneView } from "@/components/portali/campagne/gestione-campagne-view";
import { elencoCampagne } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";

export const metadata = { title: "Gestione campagne" };
export const dynamic = "force-dynamic";

export default async function GestioneCampagnePage() {
  await richiediAdmin();
  return (
    <div className="mx-auto max-w-5xl">
      <GestioneCampagneView campagne={await elencoCampagne()} />
    </div>
  );
}
