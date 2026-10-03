import Link from "next/link";
import { AlertRigheMancanti } from "@/components/portali/campagne/alert-righe-mancanti";
import { RicercaCliente } from "@/components/portali/campagne/ricerca-cliente";
import { Ricontrolla } from "@/components/portali/campagne/ricontrolla";
import { StatoInvioChip, Pannello, TitoloPagina } from "@/components/portali/campagne/ui";
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
    { chiave: "da_preparare", numero: conteggi.da_preparare, testo: "da preparare", href: "/campagne/da-preparare", pallino: "#ef4444" },
    { chiave: "preparata", numero: conteggi.preparate, testo: "buste preparate", href: "/campagne/invii?stato=preparata", pallino: STATO_INVIO_UI.preparata.pallino },
    { chiave: "da_spedire", numero: conteggi.da_spedire, testo: "da spedire", href: "/campagne/invii?stato=da_spedire", pallino: STATO_INVIO_UI.da_spedire.pallino },
    { chiave: "anomalie", numero: conteggi.anomalie, testo: "anomalie", href: "/campagne/anomalie", pallino: null },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <AlertRigheMancanti anomalie={righeMancanti} />
      <TitoloPagina titolo="Campagne Marketing" sottotitolo="Cerca il cliente: il programma ti dice cosa fare." />

      <Pannello className="mb-6">
        <RicercaCliente autoFocus />
      </Pannello>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tessere.map((t) => (
          <Link
            key={t.chiave}
            href={t.href}
            className="rounded-xl border border-border bg-white p-4 shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-2">
              {t.pallino ? (
                <span className="h-3 w-3 rounded-full" style={{ background: t.pallino }} aria-hidden />
              ) : (
                <span aria-hidden className="text-base leading-none">⚠️</span>
              )}
              <span className="font-tenorite text-3xl font-bold text-text">{t.numero.toLocaleString("it-IT")}</span>
            </div>
            <p className="mt-1 text-sm text-text-muted">{t.testo}</p>
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
        azioni={
          <Link href="/campagne/invii" className="text-xs font-medium text-primary hover:underline">
            Tutti gli invii
          </Link>
        }
      >
        {aperti.length === 0 ? (
          <p className="text-sm text-text-muted">Nessuna busta in lavorazione.</p>
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
