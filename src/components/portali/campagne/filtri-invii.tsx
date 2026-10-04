import Link from "next/link";
import type { CampagnaRiepilogo, StatoInvio } from "@/lib/portali/campagne/tipi";
import { SelezioneCampagne } from "./selezione-campagne";

/**
 * Il modulo dei filtri della pagina Invii. E' un form GET: l'indirizzo resta
 * condivisibile e il server fa il resto. Le campagne sono chip che si accendono con
 * un clic (una casella nascosta sotto, quindi funziona anche senza JavaScript).
 */
export function FiltriInvii({
  vista,
  campagne,
  selezionate,
  q,
  stato,
  utenti = [],
  utente,
}: {
  vista: "invii" | "clienti";
  campagne: Pick<CampagnaRiepilogo, "id" | "codice" | "nome">[];
  selezionate: string[];
  q: string;
  stato?: StatoInvio;
  /** Chi ha seguito degli invii (nome e cognome intranet), per il filtro «seguita da». */
  utenti?: { id: string; nome: string }[];
  utente?: string;
}) {
  return (
      <form method="get" className="mb-5 rounded-2xl border border-border bg-white p-4 shadow-sm">
        {vista === "clienti" ? <input type="hidden" name="vista" value="clienti" /> : null}
        {vista === "invii" && stato ? <input type="hidden" name="stato" value={stato} /> : null}

        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted">
            Campagne <span className="font-normal normal-case tracking-normal">(scegline quante vuoi; nessuna = tutte)</span>
          </span>
          {campagne.length === 0 ? (
            <span className="text-sm text-text-muted">Nessuna campagna.</span>
          ) : (
            // `key`: se cambiano le campagne scelte nell'indirizzo il menu riparte dalla nuova scelta.
            <SelezioneCampagne key={selezionate.join(",")} campagne={campagne} selezionate={selezionate} />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">Cliente</span>
            <input name="q" defaultValue={q} placeholder="Nome o codice" className="h-9 w-56 rounded-lg border border-border bg-white px-3 text-sm" />
          </label>
          {vista === "invii" ? (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-text-muted">Seguita da</span>
              <select name="utente_id" defaultValue={utente ?? ""} className="h-9 w-56 rounded-lg border border-border bg-white px-3 text-sm" aria-label="Seguita da">
                <option value="">Tutti</option>
                {utenti.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="submit" className="h-9 rounded-lg bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark">
            Applica
          </button>
          {selezionate.length > 0 || q || utente ? (
            <Link href={vista === "clienti" ? "/campagne/invii?vista=clienti" : "/campagne/invii"} className="text-sm text-text-muted hover:underline">
              Azzera
            </Link>
          ) : null}
        </div>
      </form>
  );
}
