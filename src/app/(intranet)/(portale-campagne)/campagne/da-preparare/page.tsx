import { PackagePlus } from "lucide-react";
import Link from "next/link";
import { Pannello, TitoloPagina, Vuoto, classeRiga, classeTh } from "@/components/portali/campagne/ui";
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
        icona={PackagePlus}
        titolo="Da preparare"
        sottotitolo="Ordini aperti degli ultimi 14 giorni che aspettano la loro busta. Apri il cliente: la campagna suggerita è già indicata."
      />
      <Pannello>
        {lista.length === 0 ? (
          <Vuoto icona={PackagePlus} titolo="Nessun ordine in attesa di una busta" testo="Quando arriva un ordine nuovo di un cliente a cui spetta una campagna, compare qui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={classeTh}>Cliente</th>
                  <th className={classeTh}>Ordine</th>
                  <th className={classeTh}>Data ordine</th>
                  <th className={classeTh}>Consegna prevista</th>
                  <th className={classeTh}>Campagna suggerita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((r) => (
                  <tr key={`${r.codice_cliente}|${r.ordine_anno}|${r.ordine_numero}`} className={classeRiga}>
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
