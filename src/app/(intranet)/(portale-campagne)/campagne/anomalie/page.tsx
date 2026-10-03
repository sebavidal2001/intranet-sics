import { AnomalieView, CartaAnomalia } from "@/components/portali/campagne/anomalie-view";
import { Pannello, TitoloPagina } from "@/components/portali/campagne/ui";
import { Ricontrolla } from "@/components/portali/campagne/ricontrolla";
import { elencoAnomalie, ultimoControllo } from "@/lib/portali/campagne/impresa";
import { richiediOperatore } from "@/lib/portali/campagne/pagine";

export const metadata = { title: "Anomalie" };
export const dynamic = "force-dynamic";

/**
 * Le anomalie, visibili anche al back office: sono loro che le correggono, senza
 * aspettare il controllo di chi supervisiona. Il controllo le ricalcola ogni
 * notte e le chiude da solo quando il problema sparisce.
 */
export default async function AnomaliePage() {
  await richiediOperatore();
  const [aperte, lasciate, ultimo] = await Promise.all([
    elencoAnomalie({ stato: "aperta" }),
    elencoAnomalie({ stato: "ignorata" }),
    ultimoControllo(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <TitoloPagina
        titolo="Anomalie"
        sottotitolo="Quello che non torna fra le buste e gli ordini in Impresa. Si chiudono da sole quando le correggi, dopo il controllo notturno."
      />
      <div className="mb-6">
        <Ricontrolla ultimo={ultimo} />
      </div>

      <AnomalieView anomalie={aperte} />

      {lasciate.length > 0 ? (
        <Pannello titolo={`Lasciate così · ${lasciate.length}`} className="mt-6">
          <ul className="divide-y divide-border">
            {lasciate.map((a) => (
              <CartaAnomalia key={a.id} anomalia={a} />
            ))}
          </ul>
        </Pannello>
      ) : null}
    </div>
  );
}
