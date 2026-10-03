import Link from "next/link";
import type { CampagnaRiepilogo, StatoInvio } from "@/lib/portali/campagne/tipi";

export const MODI_CLIENTI = [
  { valore: "almeno_una", etichetta: "Hanno ricevuto almeno" },
  { valore: "tutte", etichetta: "Le hanno ricevute tutte" },
  { valore: "nessuna", etichetta: "Non ne hanno ricevuta nessuna" },
] as const;

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
  modo,
  min,
  utenti = [],
  utente,
}: {
  vista: "invii" | "clienti";
  campagne: Pick<CampagnaRiepilogo, "id" | "codice" | "nome">[];
  selezionate: string[];
  q: string;
  stato?: StatoInvio;
  modo: "almeno_una" | "tutte" | "nessuna";
  min: number;
  /** Chi ha seguito degli invii (nome e cognome intranet), per il filtro «seguita da». */
  utenti?: { id: string; nome: string }[];
  utente?: string;
}) {
  const MODI = MODI_CLIENTI;
  return (
      <form method="get" className="mb-5 rounded-2xl border border-border bg-white p-4 shadow-sm">
        {vista === "clienti" ? <input type="hidden" name="vista" value="clienti" /> : null}
        {vista === "invii" && stato ? <input type="hidden" name="stato" value={stato} /> : null}

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Campagne <span className="font-normal normal-case tracking-normal">(scegline quante vuoi; nessuna = tutte)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {campagne.map((c) => (
              <label key={c.id} className="cursor-pointer">
                <input type="checkbox" name="campagna_id" value={c.id} defaultChecked={selezionate.includes(c.id)} className="peer sr-only" />
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text transition-colors hover:border-primary/50 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2">
                  {c.codice}
                  <span className="text-xs font-normal opacity-80">{c.nome}</span>
                </span>
              </label>
            ))}
            {campagne.length === 0 ? <span className="text-sm text-text-muted">Nessuna campagna.</span> : null}
          </div>
        </fieldset>

        {vista === "clienti" ? (
          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Quali clienti</legend>
            <div className="flex flex-wrap items-center gap-2">
              {MODI.map((m) => (
                <label key={m.valore} className="cursor-pointer">
                  <input type="radio" name="modo" value={m.valore} defaultChecked={modo === m.valore} className="peer sr-only" />
                  <span className="inline-flex rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium text-text transition-colors hover:border-primary/50 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary-dark peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                    {m.etichetta}
                  </span>
                </label>
              ))}
              <label className="inline-flex items-center gap-2 text-sm text-text">
                <input
                  type="number"
                  name="min"
                  min={1}
                  max={50}
                  defaultValue={min}
                  aria-label="Quante campagne almeno"
                  className="h-9 w-16 rounded-lg border border-border bg-white px-2 text-center text-sm"
                />
                <span className="text-text-muted">delle campagne scelte (solo per «almeno»)</span>
              </label>
            </div>
          </fieldset>
        ) : null}

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
