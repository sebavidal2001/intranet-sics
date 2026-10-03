import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { Pannello, Tessera, Vuoto, classeRiga, classeTh } from "@/components/portali/campagne/ui";
import {
  FINESTRE,
  motivoEsclusione,
  ordina,
  confrontabile,
  type Finestra,
  type OrdineAnalisi,
  type RiepilogoAnalisi,
} from "@/lib/portali/campagne/analisi";
import type { AnalisiCampagna } from "@/lib/portali/campagne/analisi-dati";
import type { CampagnaRiepilogo } from "@/lib/portali/campagne/tipi";

const euro = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const intero = (n: number) => n.toLocaleString("it-IT");
const percento = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("it-IT", { maximumFractionDigits: 0 })}%`);
const data = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });

const href = (campagna: string, mesi: number, ordine: OrdineAnalisi) => `/campagne/analisi?campagna=${campagna}&mesi=${mesi}&ordine=${ordine}`;

const chip = (attivo: boolean) =>
  `inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
    attivo ? "border-primary bg-primary text-white" : "border-border bg-white text-text hover:border-primary/50 hover:bg-primary/5"
  }`;

export function SceltaCampagnaEFinestra({
  campagne,
  scelta,
  mesi,
  ordine,
}: {
  campagne: CampagnaRiepilogo[];
  scelta: string;
  mesi: Finestra;
  ordine: OrdineAnalisi;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Campagna</span>
        {campagne.map((c) => (
          <Link key={c.id} href={href(c.id, mesi, ordine)} className={chip(c.id === scelta)} aria-current={c.id === scelta ? "page" : undefined}>
            {c.codice}
            <span className="ml-1.5 opacity-70">· {c.nome}</span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Finestra</span>
        {FINESTRE.map((m) => (
          <Link key={m} href={href(scelta, m, ordine)} className={chip(m === mesi)} aria-current={m === mesi ? "page" : undefined}>
            {m} mesi prima e dopo
          </Link>
        ))}
      </div>
    </div>
  );
}

function Variazione({ prima, dopo }: { prima: number; dopo: number }) {
  if (dopo > prima) return <ArrowUpRight className="h-4 w-4 text-emerald-600" aria-label="in aumento" />;
  if (dopo < prima) return <ArrowDownRight className="h-4 w-4 text-red-600" aria-label="in calo" />;
  return <Minus className="h-4 w-4 text-text-muted" aria-label="invariato" />;
}

function Confronto({ riepiloghi, mesi }: { riepiloghi: RiepilogoAnalisi[]; mesi: number }) {
  const conPromossi = riepiloghi.some((r) => r.promossi);
  return (
    <Pannello titolo="Confronto fra le finestre" descrizione="Solo i clienti con tutta la finestra, prima e dopo, dentro lo storico: gli altri non si confrontano." className="mb-6" senzaPadding>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={`${classeTh} pl-5`}></th>
              {riepiloghi.map((r) => (
                <th key={r.mesi} className={`${classeTh} text-right ${r.mesi === mesi ? "text-primary" : ""}`}>{r.mesi} mesi</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr className={classeRiga}>
              <td className="py-2.5 pl-5 pr-3 text-text-muted">Clienti confrontati</td>
              {riepiloghi.map((r) => (
                <td key={r.mesi} className="py-2.5 pr-5 text-right tabular-nums">{intero(r.confrontabili)} <span className="text-text-muted">/ {intero(r.ricevuti)}</span></td>
              ))}
            </tr>
            <tr className={classeRiga}>
              <td className="py-2.5 pl-5 pr-3 text-text-muted">Acquisti prima</td>
              {riepiloghi.map((r) => <td key={r.mesi} className="py-2.5 pr-5 text-right tabular-nums">{euro(r.prima)}</td>)}
            </tr>
            <tr className={classeRiga}>
              <td className="py-2.5 pl-5 pr-3 text-text-muted">Acquisti dopo</td>
              {riepiloghi.map((r) => <td key={r.mesi} className="py-2.5 pr-5 text-right tabular-nums">{euro(r.dopo)}</td>)}
            </tr>
            <tr className={classeRiga}>
              <td className="py-2.5 pl-5 pr-3 font-medium">Variazione</td>
              {riepiloghi.map((r) => <td key={r.mesi} className="py-2.5 pr-5 text-right font-semibold tabular-nums">{percento(r.variazione)}</td>)}
            </tr>
            <tr className={classeRiga}>
              <td className="py-2.5 pl-5 pr-3 text-text-muted">Clienti in aumento / in calo</td>
              {riepiloghi.map((r) => <td key={r.mesi} className="py-2.5 pr-5 text-right tabular-nums">{intero(r.in_aumento)} / {intero(r.in_calo)}</td>)}
            </tr>
            {conPromossi ? (
              <>
                <tr className={classeRiga}>
                  <td className="py-2.5 pl-5 pr-3 text-text-muted">Prodotti promossi: prima → dopo</td>
                  {riepiloghi.map((r) => (
                    <td key={r.mesi} className="py-2.5 pr-5 text-right tabular-nums">{r.promossi ? `${euro(r.promossi.prima)} → ${euro(r.promossi.dopo)}` : "—"}</td>
                  ))}
                </tr>
                <tr className={classeRiga}>
                  <td className="py-2.5 pl-5 pr-3 text-text-muted">Mai acquistati prima, ora sì</td>
                  {riepiloghi.map((r) => (
                    <td key={r.mesi} className="py-2.5 pr-5 text-right tabular-nums">
                      {r.promossi ? <>{intero(r.promossi.nuovi_acquirenti)} <span className="text-text-muted">/ {intero(r.promossi.con_dopo_completa)}</span></> : "—"}
                    </td>
                  ))}
                </tr>
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </Pannello>
  );
}

export function AnalisiView({ analisi, ordine }: { analisi: AnalisiCampagna; ordine: OrdineAnalisi }) {
  const { campagna, righe, confronto, mesi, storico } = analisi;
  const attuale = confronto.find((r) => r.mesi === mesi) as RiepilogoAnalisi;
  const promossiConfigurati = campagna.articoli_promossi.length > 0;
  const ordinate = ordina(righe, ordine);

  if (righe.length === 0) {
    return (
      <Vuoto
        titolo="Nessun cliente ha ancora ricevuto questa campagna"
        testo="L'analisi parte dai clienti con la busta consegnata (o consegnata al banco)."
      />
    );
  }

  return (
    <>
      <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="leading-relaxed">
          Gli acquisti sono le righe di fattura, già al netto delle note di credito
          {storico ? <> · il fatturato disponibile va dal <strong>{data(storico.dal)}</strong> al <strong>{data(storico.al)}</strong></> : null}.
          Lo scopo delle campagne è far conoscere SICS e restare presenti: questa analisi è un&apos;indicazione, non un obiettivo di vendita.
        </p>
      </div>

      {!promossiConfigurati ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Per questa campagna non sono indicati gli <strong>articoli promossi</strong>: vedi solo gli acquisti totali.{" "}
          <Link href={`/campagne/gestione/${campagna.id}`} className="font-medium underline">Indicali nella scheda della campagna</Link>{" "}
          (codici separati da virgola; con l&apos;asterisco un prefisso, es. <code className="rounded bg-white/70 px-1">AFD.00.*</code>) per sapere chi li compra e chi non li aveva mai presi.
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tessera numero={intero(attuale.ricevuti)} testo="clienti che l'hanno ricevuta" colore="#00a1be" />
        <Tessera numero={`${intero(attuale.confrontabili)}`} testo={`confrontabili a ${mesi} mesi`} colore="#64748b" />
        <Tessera numero={percento(attuale.variazione)} testo={`acquisti dopo / prima (${euro(attuale.prima)} → ${euro(attuale.dopo)})`} colore={attuale.variazione !== null && attuale.variazione < 0 ? "#ef4444" : "#22c55e"} />
        <Tessera
          numero={attuale.promossi ? `${intero(attuale.promossi.nuovi_acquirenti)}` : "—"}
          testo={attuale.promossi ? `mai presi i promossi prima, ora sì (su ${intero(attuale.promossi.con_dopo_completa)} valutabili)` : "nuovi acquirenti dei promossi"}
          colore="#f59e0b"
        />
      </div>

      {attuale.confrontabili === 0 ? (
        <div className="mb-6 rounded-xl border border-border bg-white px-4 py-3 text-sm text-text-muted">
          Con {mesi} mesi nessun cliente è ancora confrontabile: {intero(attuale.senza_dopo)} non hanno ancora tutto il «dopo», {intero(attuale.senza_prima)} non hanno tutto il «prima» nello storico. Prova una finestra più corta.
        </div>
      ) : null}

      <Confronto riepiloghi={confronto} mesi={mesi} />

      <Pannello
        titolo={`Clienti · ${intero(righe.length)}`}
        descrizione={`Acquisti nei ${mesi} mesi prima e dopo la consegna della busta.`}
        senzaPadding
        azioni={
          <div className="flex gap-1.5 text-xs">
            {(["nome", "aumento", "calo"] as OrdineAnalisi[]).map((o) => (
              <Link key={o} href={href(campagna.id, mesi, o)} className={chip(o === ordine)}>
                {o === "nome" ? "Per nome" : o === "aumento" ? "Più cresciuti" : "Più calati"}
              </Link>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className={`${classeTh} pl-5`}>Cliente</th>
                <th className={classeTh}>Busta</th>
                <th className={`${classeTh} text-right`}>Prima</th>
                <th className={`${classeTh} text-right`}>Dopo</th>
                <th className={classeTh}></th>
                {promossiConfigurati ? <th className={`${classeTh} text-right`}>Promossi prima → dopo</th> : null}
                <th className={`${classeTh} pr-5`}>Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordinate.map((r) => {
                const motivo = motivoEsclusione(r, mesi);
                const conf = confrontabile(r);
                return (
                  <tr key={r.codice_cliente} className={classeRiga}>
                    <td className="py-2.5 pl-5 pr-3">
                      <Link href={`/campagne/clienti/${encodeURIComponent(r.codice_cliente)}`} className="font-medium text-text hover:text-primary hover:underline">
                        {r.ragione_sociale ?? r.codice_cliente}
                      </Link>
                      <div className="text-xs text-text-muted">{r.codice_cliente}{r.agente_nome ? ` · ${r.agente_nome}` : ""}</div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">{data(r.data_invio)}</td>
                    <td className={`py-2.5 pr-3 text-right tabular-nums ${r.prima_completa ? "" : "text-text-muted"}`}>{euro(r.prima_tot)}</td>
                    <td className={`py-2.5 pr-3 text-right tabular-nums ${r.dopo_completa ? "" : "text-text-muted"}`}>{euro(r.dopo_tot)}</td>
                    <td className="py-2.5 pr-3">{conf ? <Variazione prima={r.prima_tot} dopo={r.dopo_tot} /> : null}</td>
                    {promossiConfigurati ? (
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {euro(r.prima_prom ?? 0)} → {euro(r.dopo_prom ?? 0)}
                        {r.mai_prima_prom && (r.dopo_prom ?? 0) > 0 ? <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">nuovo</span> : null}
                      </td>
                    ) : null}
                    <td className="py-2.5 pr-5 text-xs text-text-muted">{motivo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Pannello>
    </>
  );
}

