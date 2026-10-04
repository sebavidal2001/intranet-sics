import Link from "next/link";
import { ListChecks, Users } from "lucide-react";
import { FiltriInvii } from "@/components/portali/campagne/filtri-invii";
import { TabellaClienti } from "@/components/portali/campagne/tabella-clienti";
import { Pannello, StatoInvioChip, TitoloPagina, Vuoto, classeRiga, classeTh } from "@/components/portali/campagne/ui";
import { formattaData, formattaDataOra } from "@/components/portali/campagne/api-client";
import { clientiPerCampagne, elencoCampagne, elencoInvii, utentiInvii } from "@/lib/portali/campagne/dati";
import { richiediOperatore } from "@/lib/portali/campagne/pagine";
import { FiltroClientiCampagne, FiltroInvii } from "@/lib/portali/campagne/schemi";
import { STATO_INVIO_UI, etichettaOrdine } from "@/lib/portali/campagne/stati";
import type { CampagnaRiepilogo, StatoInvio } from "@/lib/portali/campagne/tipi";

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
type Parametri = Record<string, string | string[] | number | undefined>;

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Costruisce un indirizzo ripetendo i parametri multipli (`campagna_id=a&campagna_id=b`). */
function indirizzo(p: Parametri): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, String(v));
  }
  const s = q.toString();
  return `/campagne/invii${s ? `?${s}` : ""}`;
}

/** Elenco invii: due viste, «per invio» (ogni busta) e «per cliente» (chi ha ricevuto quali campagne). */
export default async function InviiPage({ searchParams }: { searchParams: Promise<Ricerca> }) {
  await richiediOperatore();
  const grezzo = await searchParams;
  const vista = uno(grezzo.vista) === "clienti" ? "clienti" : "invii";

  // Un parametro non valido nell'indirizzo non deve dare un errore: si ignora.
  const comuni = { ...grezzo, vista: undefined };
  const fInvii = FiltroInvii.safeParse(comuni);
  const filtroInvii = fInvii.success ? fInvii.data : FiltroInvii.parse({});
  const fClienti = FiltroClientiCampagne.safeParse({ ...comuni, stato: undefined });
  const filtroClienti = fClienti.success ? fClienti.data : FiltroClientiCampagne.parse({});

  // L'elenco delle campagne serve ai chip: se non e' leggibile la pagina funziona lo stesso.
  const campagne = await elencoCampagne().catch(() => [] as CampagnaRiepilogo[]);
  const selezionate = (vista === "clienti" ? filtroClienti.campagna_id : filtroInvii.campagna_id) ?? [];
  const q = (vista === "clienti" ? filtroClienti.q : filtroInvii.q) ?? "";

  // Chi ha seguito gli invii: serve al filtro della vista per invio. Se non e' leggibile la pagina funziona lo stesso.
  const utenti = vista === "invii" ? await utentiInvii().catch(() => []) : [];
  const utente = vista === "invii" ? filtroInvii.utente_id : undefined;

  const base: Parametri = { vista: vista === "clienti" ? "clienti" : undefined, campagna_id: selezionate, q, utente_id: utente };

  return (
    <div className="mx-auto max-w-5xl">
      <TitoloPagina
        icona={ListChecks}
        titolo="Invii"
        sottotitolo={
          vista === "clienti"
            ? "Chi ha ricevuto quali campagne: scegli una o più campagne per vedere i clienti che ne hanno ricevuta almeno una."
            : "Tutte le buste, dalla più recente. Scegli una o più campagne per restringere l'elenco."
        }
      />

      {/* Le due viste */}
      <div className="mb-4 inline-flex rounded-xl border border-border bg-white p-1 shadow-sm" role="tablist" aria-label="Vista">
        <Link
          href={indirizzo({ campagna_id: selezionate, q, utente_id: utente })}
          role="tab"
          aria-selected={vista === "invii"}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${vista === "invii" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:bg-bg-page hover:text-text"}`}
        >
          <ListChecks className="h-4 w-4" aria-hidden /> Per invio
        </Link>
        <Link
          href={indirizzo({ vista: "clienti", campagna_id: selezionate, q })}
          role="tab"
          aria-selected={vista === "clienti"}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${vista === "clienti" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:bg-bg-page hover:text-text"}`}
        >
          <Users className="h-4 w-4" aria-hidden /> Per cliente
        </Link>
      </div>

      {vista === "invii" ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {SCHEDE.map((s) => {
            const attiva = (filtroInvii.stato ?? "") === s.valore;
            return (
              <Link
                key={s.valore || "tutti"}
                href={indirizzo({ ...base, stato: s.valore || undefined })}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  attiva ? "border-primary bg-primary text-white" : "border-border bg-white text-text hover:bg-bg-page"
                }`}
              >
                {s.valore ? (
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: STATO_INVIO_UI[s.valore].pallino }} aria-hidden />
                ) : null}
                {s.etichetta}
              </Link>
            );
          })}
        </div>
      ) : null}

      <FiltriInvii
        vista={vista}
        campagne={campagne}
        selezionate={selezionate}
        q={q}
        stato={filtroInvii.stato}
        utenti={utenti}
        utente={utente}
      />

      {vista === "clienti" ? (
        <VistaClienti filtro={filtroClienti} campagne={campagne} base={base} />
      ) : (
        <VistaInvii filtro={filtroInvii} base={base} />
      )}
    </div>
  );
}

// ─── Per cliente ───────────────────────────────────────────────────────────
async function VistaClienti({
  filtro,
  campagne,
  base,
}: {
  filtro: ReturnType<typeof FiltroClientiCampagne.parse>;
  campagne: CampagnaRiepilogo[];
  base: Parametri;
}) {
  const { clienti, totale } = await clientiPerCampagne(filtro);
  const scelte = (filtro.campagna_id ?? []).map((id) => campagne.find((c) => c.id === id)?.codice).filter(Boolean) as string[];
  const elencoScelte = scelte.length > 0 ? scelte.join(", ") : "tutte le campagne";

  const frase = `hanno ricevuto almeno una fra: ${elencoScelte}`;

  const da = totale === 0 ? 0 : filtro.offset + 1;
  const a = Math.min(filtro.offset + filtro.limit, totale);

  return (
    <Pannello
      senzaPadding
      titolo={`${totale.toLocaleString("it-IT")} clienti`}
      descrizione={frase}
    >
      {clienti.length === 0 ? (
        <Vuoto icona={Users} titolo="Nessun cliente con questi criteri" testo="Prova a cambiare le campagne scelte." />
      ) : (
        <TabellaClienti clienti={clienti} />
      )}
      <Paginazione offset={filtro.offset} limite={filtro.limit} totale={totale} da={da} a={a} base={base} />
    </Pannello>
  );
}

// ─── Per invio ─────────────────────────────────────────────────────────────
async function VistaInvii({ filtro, base }: { filtro: ReturnType<typeof FiltroInvii.parse>; base: Parametri }) {
  const { invii, totale } = await elencoInvii(filtro);
  const da = totale === 0 ? 0 : filtro.offset + 1;
  const a = Math.min(filtro.offset + filtro.limit, totale);

  return (
    <Pannello senzaPadding titolo={`${totale.toLocaleString("it-IT")} invii`}>
      {invii.length === 0 ? (
        <Vuoto icona={ListChecks} titolo="Nessun invio con questi filtri" testo="Togli qualche filtro per allargare l'elenco." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-page/60">
                <th className={`${classeTh} pl-5`}>Cliente</th>
                <th className={classeTh}>Campagna</th>
                <th className={classeTh}>Stato</th>
                <th className={classeTh}>Ordine</th>
                <th className={classeTh}>Referente</th>
                <th className={classeTh}>Seguita da</th>
                <th className={`${classeTh} pr-5`}>Consegna</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invii.map((i) => (
                <tr key={i.id} className={`align-top ${classeRiga}`}>
                  <td className="py-3 pl-5 pr-3">
                    <Link href={`/campagne/clienti/${encodeURIComponent(i.codice_cliente)}`} className="font-semibold text-text hover:text-primary">
                      {i.ragione_sociale}
                    </Link>
                    <span className="block text-xs text-text-muted">{i.codice_cliente}</span>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap font-medium">{i.campagna?.codice ?? "—"}</td>
                  <td className="py-3 pr-3">
                    <StatoInvioChip stato={i.stato} />
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">{etichettaOrdine(i) ?? <span className="text-text-muted">—</span>}</td>
                  <td className="py-3 pr-3">{i.referente ?? <span className="text-text-muted">—</span>}</td>
                  <td className="py-3 pr-3">
                    {i.assegnata_da_nome ? (
                      <span className="font-medium text-text">{i.assegnata_da_nome}</span>
                    ) : (
                      <span className="text-text-muted">{i.origine === "import_excel" ? "storico Excel" : "—"}</span>
                    )}
                    {i.consegna_registrata_da_nome && i.consegna_registrata_da_nome !== i.assegnata_da_nome ? (
                      <span className="block text-xs text-text-muted">consegna: {i.consegna_registrata_da_nome}</span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-5 whitespace-nowrap">
                    {i.data_consegna ? formattaData(i.data_consegna) : <span className="text-text-muted">assegnata {formattaDataOra(i.assegnata_il)}</span>}
                    {i.ddt_numero ? <span className="block text-xs text-text-muted">DDT {i.ddt_numero}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginazione offset={filtro.offset} limite={filtro.limit} totale={totale} da={da} a={a} base={{ ...base, stato: filtro.stato }} />
    </Pannello>
  );
}

function Paginazione({ offset, limite, totale, da, a, base }: { offset: number; limite: number; totale: number; da: number; a: number; base: Parametri }) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-bg-page/40 px-5 py-3 text-sm text-text-muted">
      <span>{totale === 0 ? "0 risultati" : `${da}–${a} di ${totale.toLocaleString("it-IT")}`}</span>
      <span className="flex gap-4">
        {offset > 0 ? (
          <Link href={indirizzo({ ...base, offset: Math.max(0, offset - limite) || undefined })} className="font-medium text-primary hover:underline">
            ← Precedenti
          </Link>
        ) : null}
        {offset + limite < totale ? (
          <Link href={indirizzo({ ...base, offset: offset + limite })} className="font-medium text-primary hover:underline">
            Successivi →
          </Link>
        ) : null}
      </span>
    </div>
  );
}
