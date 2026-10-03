import Link from "next/link";
import { STATO_INVIO_UI } from "@/lib/portali/campagne/stati";
import type { ClienteConCampagne } from "@/lib/portali/campagne/tipi";
import { formattaData } from "./api-client";
import { classeRiga, classeTh } from "./ui";

/**
 * «Chi ha ricevuto quali campagne»: una riga per cliente, con una targhetta per ogni
 * campagna. Verde = ricevuta (con la data), arancio = busta ancora in lavorazione; le
 * campagne scelte nel filtro hanno un contorno azzurro, cosi' si vede subito a colpo
 * d'occhio perche' il cliente e' nell'elenco.
 */
export function TabellaClienti({ clienti }: { clienti: ClienteConCampagne[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-page/60">
            <th className={`${classeTh} pl-5`}>Cliente</th>
            <th className={classeTh}>Commerciale</th>
            <th className={`${classeTh} text-center`}>Ricevute</th>
            <th className={`${classeTh} pr-5`}>Campagne</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {clienti.map((c) => (
            <tr key={c.codice_cliente} className={`align-top ${classeRiga}`}>
              <td className="py-3 pl-5 pr-3">
                <Link href={`/campagne/clienti/${encodeURIComponent(c.codice_cliente)}`} className="font-semibold text-text hover:text-primary">
                  {c.ragione_sociale}
                </Link>
                <span className="block text-xs text-text-muted">
                  {c.codice_cliente}
                  {c.cat_attivita ? ` · ${c.cat_attivita}` : ""}
                </span>
              </td>
              <td className="py-3 pr-3 text-text-muted">{c.agente_nome ?? "—"}</td>
              <td className="py-3 pr-3 text-center">
                <span className={`inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs font-bold ${c.n_ricevute > 0 ? "bg-success/10 text-success" : "bg-bg-page text-text-muted"}`}>
                  {c.n_ricevute}
                </span>
              </td>
              <td className="py-3 pr-5">
                <div className="flex flex-wrap gap-1.5">
                  {c.campagne.map((k) => {
                    const ricevuta = k.stato === "consegnata" || k.stato === "consegnata_banco";
                    return (
                      <span
                        key={k.codice}
                        title={`${k.nome} · ${STATO_INVIO_UI[k.stato].etichetta}${k.data ? ` · ${formattaData(k.data)}` : ""}`}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium ${
                          ricevuta ? "border-success/30 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"
                        } ${k.selezionata ? "ring-2 ring-primary ring-offset-1" : ""}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATO_INVIO_UI[k.stato].pallino }} aria-hidden />
                        {k.codice}
                        <span className="font-normal opacity-80">{k.data ? formattaData(k.data).slice(0, 5) : "in corso"}</span>
                      </span>
                    );
                  })}
                  {c.campagne.length === 0 ? <span className="text-xs text-text-muted">nessuna ancora</span> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
