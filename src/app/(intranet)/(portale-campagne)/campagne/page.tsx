import Link from "next/link";
import { ClipboardList, PackageCheck, PackagePlus, Search, TriangleAlert, Truck } from "lucide-react";
import { AlertRigheMancanti } from "@/components/portali/campagne/alert-righe-mancanti";
import { RicercaCliente } from "@/components/portali/campagne/ricerca-cliente";
import { Ricontrolla } from "@/components/portali/campagne/ricontrolla";
import { Pannello, StatoInvioChip, Tessera, TitoloPagina, Vuoto } from "@/components/portali/campagne/ui";
import { formattaDataOra } from "@/components/portali/campagne/api-client";
import { inviiAperti } from "@/lib/portali/campagne/dati";
import { dashboardCompleta, elencoAnomalie } from "@/lib/portali/campagne/impresa";
import { richiediOperatore } from "@/lib/portali/campagne/pagine";
import { STATO_INVIO_UI, etichettaOrdine } from "@/lib/portali/campagne/stati";

export const metadata = { title: "Campagne Marketing" };
export const dynamic = "force-dynamic";

/** Home del back office: cerco il cliente, vedo subito cosa devo ancora fare. */
export default async function CampagneHomePage() {
  await richiediOperatore();
  const [conteggi, aperti, righeMancanti] = await Promise.all([
    dashboardCompleta(),
    inviiAperti(10),
    elencoAnomalie({ tipo: "riga_mancante" }),
  ]);

  const tessere = [
    { chiave: "da_preparare", numero: conteggi.da_preparare, testo: "da preparare", href: "/campagne/da-preparare", colore: "#ef4444", icona: PackagePlus },
    { chiave: "preparata", numero: conteggi.preparate, testo: "buste preparate", href: "/campagne/invii?stato=preparata", colore: STATO_INVIO_UI.preparata.pallino, icona: PackageCheck },
    { chiave: "da_spedire", numero: conteggi.da_spedire, testo: "da spedire", href: "/campagne/invii?stato=da_spedire", colore: STATO_INVIO_UI.da_spedire.pallino, icona: Truck },
    { chiave: "anomalie", numero: conteggi.anomalie, testo: "anomalie da vedere", href: "/campagne/anomalie", colore: "#dc2626", icona: TriangleAlert },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <AlertRigheMancanti anomalie={righeMancanti} />
      <TitoloPagina icona={Search} titolo="Campagne Marketing" sottotitolo="Cerca il cliente: il programma ti dice cosa fare." />

      <Pannello className="mb-6">
        <RicercaCliente autoFocus />
      </Pannello>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tessere.map((t) => (
          <Link key={t.chiave} href={t.href} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <Tessera numero={t.numero.toLocaleString("it-IT")} testo={t.testo} colore={t.colore} icona={t.icona} />
          </Link>
        ))}
      </div>
      <p className="mb-6 text-xs text-text-muted">
        {conteggi.consegnate_30_giorni.toLocaleString("it-IT")} consegnate negli ultimi 30 giorni ·{" "}
        <Link href="/campagne/invii?stato=consegnata" className="text-primary hover:underline">
          vedi
        </Link>
      </p>

      <Pannello
        titolo="Buste in lavorazione"
        icona={ClipboardList}
        azioni={
          <Link href="/campagne/invii" className="text-xs font-medium text-primary hover:underline">
            Tutti gli invii
          </Link>
        }
      >
        {aperti.length === 0 ? (
          <Vuoto icona={PackageCheck} titolo="Nessuna busta in lavorazione" testo="Cerca un cliente per prepararne una." />
        ) : (
          <ul className="divide-y divide-border">
            {aperti.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/campagne/clienti/${encodeURIComponent(i.codice_cliente)}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:text-primary"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{i.ragione_sociale}</span>
                    <span className="block text-xs text-text-muted">
                      {i.campagna?.codice ?? "—"}
                      {etichettaOrdine(i) ? ` · ordine ${etichettaOrdine(i)}` : ""}
                      {i.referente ? ` · ${i.referente}` : ""} · {formattaDataOra(i.assegnata_il)}
                    </span>
                  </span>
                  <StatoInvioChip stato={i.stato} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Pannello>

      <div className="mt-4">
        <Ricontrolla ultimo={conteggi.ultimo_controllo} />
      </div>
    </div>
  );
}
