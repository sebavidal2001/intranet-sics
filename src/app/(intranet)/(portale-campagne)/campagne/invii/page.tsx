import Link from "next/link";
import { Pannello, StatoInvioChip, TitoloPagina } from "@/components/portali/campagne/ui";
import { formattaData, formattaDataOra } from "@/components/portali/campagne/api-client";
import { elencoCampagne, elencoInvii } from "@/lib/portali/campagne/dati";
import { richiediOperatore } from "@/lib/portali/campagne/pagine";
import { FiltroInvii } from "@/lib/portali/campagne/schemi";
import { STATO_INVIO_UI, etichettaOrdine } from "@/lib/portali/campagne/stati";
import type { StatoInvio } from "@/lib/portali/campagne/tipi";

export const metadata = { title: "Invii" };
export const dynamic = "force-dynamic";

const SCHEDE: { valore: StatoInvio | ""; etichetta: string }[] = [
  { valore: "", etichetta: "Tutti" },
  { valore: "preparata", etichetta: "Preparate" },
  { valore: "da_spedire", etichetta: "Da spedire" },
  { valore: "consegnata", etichetta: "Consegnate" },
  { valore: "consegnata_banco", etichetta: "Al banco" },
  { valore: "annullata", etichetta: "Annullate" },
];

type Ricerca = Record<string, string | string[] | undefined>;

/** Elenco invii filtrabile: è dove portano i contatori della home. */
export default async function InviiPage({ searchParams }: { searchParams: Promise<Ricerca> }) {
  await richiediOperatore();
  const grezzo = await searchParams;
  const piatto = Object.fromEntries(
    Object.entries(grezzo).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  ) as Record<string, string | undefined>;
  // Un parametro non valido nell'indirizzo non deve dare un errore: si ignora.
  const parsed = FiltroInvii.safeParse(piatto);
  const filtro = parsed.success ? parsed.data : FiltroInvii.parse({});

  // L'elenco delle campagne serve solo al filtro: se non è leggibile (non admin
  // o errore) la pagina funziona lo stesso, senza quel menu.
  const [elenco, campagne] = await Promise.all([elencoInvii(filtro), elencoCampagne().catch(() => [])]);
  const { invii, totale } = elenco;

  const href = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | number | undefined> = {
      stato: filtro.stato,
      campagna_id: filtro.campagna_id,
      q: filtro.q,
      ...extra,
    };
    for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return `/campagne/invii${s ? `?${s}` : ""}`;
  };

  const da = totale === 0 ? 0 : filtro.offset + 1;
  const a = Math.min(filtro.offset + filtro.limit, totale);

  return (
    <div className="mx-auto max-w-5xl">
      <TitoloPagina titolo="Invii" sottotitolo="Tutte le buste, dalla più recente." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SCHEDE.map((s) => {
          const attiva = (filtro.stato ?? "") === s.valore;
          return (
            <Link
              key={s.valore || "tutti"}
              href={href({ stato: s.valore || undefined, offset: undefined })}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                attiva ? "border-primary bg-primary text-white" : "border-border bg-white text-text hover:bg-bg-page"
              }`}
            >
              {s.valore ? (
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: STATO_INVIO_UI[s.valore].pallino }}
                  aria-hidden
                />
              ) : null}
              {s.etichetta}
            </Link>
          );
        })}
      </div>

      {/* Filtri come form GET: l'indirizzo resta condivisibile e il server fa il resto. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {filtro.stato ? <input type="hidden" name="stato" value={filtro.stato} /> : null}
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">Cliente</span>
          <input
            name="q"
            defaultValue={filtro.q ?? ""}
            placeholder="Nome o codice"
            className="h-9 w-56 rounded-lg border border-border bg-white px-3 text-sm"
          />
        </label>
        {campagne.length > 0 ? (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">Campagna</span>
            <select
              name="campagna_id"
              defaultValue={filtro.campagna_id ?? ""}
              className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
            >
              <option value="">Tutte</option>
              {campagne.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codice} · {c.nome}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-dark">
          Filtra
        </button>
        {filtro.q || filtro.campagna_id ? (
          <Link href={href({ q: undefined, campagna_id: undefined, offset: undefined })} className="text-sm text-text-muted hover:underline">
            Azzera
          </Link>
        ) : null}
      </form>

      <Pannello>
        {invii.length === 0 ? (
          <p className="text-sm text-text-muted">Nessun invio con questi filtri.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 font-medium">Campagna</th>
                  <th className="py-2 pr-3 font-medium">Stato</th>
                  <th className="py-2 pr-3 font-medium">Ordine</th>
                  <th className="py-2 pr-3 font-medium">Referente</th>
                  <th className="py-2 font-medium">Consegna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invii.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="py-2.5 pr-3">
                      <Link href={`/campagne/clienti/${encodeURIComponent(i.codice_cliente)}`} className="font-semibold text-text hover:text-primary">
                        {i.ragione_sociale}
                      </Link>
                      <span className="block text-xs text-text-muted">{i.codice_cliente}</span>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{i.campagna?.codice ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <StatoInvioChip stato={i.stato} />
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{etichettaOrdine(i) ?? "—"}</td>
                    <td className="py-2.5 pr-3">{i.referente ?? "—"}</td>
                    <td className="py-2.5 whitespace-nowrap">
                      {i.data_consegna ? (
                        formattaData(i.data_consegna)
                      ) : (
                        <span className="text-text-muted">assegnata {formattaDataOra(i.assegnata_il)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-sm text-text-muted">
          <span>{totale === 0 ? "0 risultati" : `${da}–${a} di ${totale.toLocaleString("it-IT")}`}</span>
          <span className="flex gap-3">
            {filtro.offset > 0 ? (
              <Link href={href({ offset: Math.max(0, filtro.offset - filtro.limit) || undefined })} className="text-primary hover:underline">
                ← Precedenti
              </Link>
            ) : null}
            {filtro.offset + filtro.limit < totale ? (
              <Link href={href({ offset: filtro.offset + filtro.limit })} className="text-primary hover:underline">
                Successivi →
              </Link>
            ) : null}
          </span>
        </div>
      </Pannello>
    </div>
  );
}
