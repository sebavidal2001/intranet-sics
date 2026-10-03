import Link from "next/link";
import { Pannello, TitoloPagina } from "@/components/portali/campagne/ui";
import { formattaData } from "@/components/portali/campagne/api-client";
import { elencoDaPreparare } from "@/lib/portali/campagne/impresa";
import { richiediOperatore } from "@/lib/portali/campagne/pagine";

export const metadata = { title: "Da preparare" };
export const dynamic = "force-dynamic";

/**
 * 🔴 Gli ordini recenti che aspettano la loro busta: ordine aperto degli ultimi
 * 14 giorni, di un cliente a cui si puo' assegnare una campagna, senza ancora ne'
 * una busta registrata ne' la riga DOCUMENTAZIONE. Gli ordini al banco non ci sono:
 * si chiudono col pulsante Banco.
 */
export default async function DaPreparareListaPage() {
  await richiediOperatore();
  const lista = await elencoDaPreparare();

  return (
    <div className="mx-auto max-w-5xl">
      <TitoloPagina
        titolo="Da preparare"
        sottotitolo="Ordini aperti degli ultimi 14 giorni che aspettano la loro busta. Apri il cliente: la campagna suggerita è già indicata."
      />
      <Pannello>
        {lista.length === 0 ? (
          <p className="text-sm text-text-muted">Nessun ordine in attesa di una busta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 font-medium">Ordine</th>
                  <th className="py-2 pr-3 font-medium">Data ordine</th>
                  <th className="py-2 pr-3 font-medium">Consegna prevista</th>
                  <th className="py-2 font-medium">Campagna suggerita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((r) => (
                  <tr key={`${r.codice_cliente}|${r.ordine_anno}|${r.ordine_numero}`}>
                    <td className="py-2.5 pr-3">
                      <Link href={`/campagne/clienti/${encodeURIComponent(r.codice_cliente)}`} className="font-semibold text-text hover:text-primary">
                        {r.ragione_sociale}
                      </Link>
                      <span className="block text-xs text-text-muted">{r.codice_cliente}</span>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {r.ordine_numero}/{r.ordine_anno}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{formattaData(r.data_ordine)}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{formattaData(r.consegna_prevista)}</td>
                    <td className="py-2.5 whitespace-nowrap">
                      {r.campagna_codice} · {r.campagna_nome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Pannello>
    </div>
  );
}
