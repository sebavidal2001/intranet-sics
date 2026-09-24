"use client";

/**
 * Vista "Acquisti": ufficio acquisti, buyer e fornitori.
 *
 * Tre domande, nell'ordine in cui si fanno:
 *  1. i fornitori consegnano quando hanno promesso? (puntualità, tempi)
 *  2. quanto lavoro fa ogni buyer, e come si distribuisce? (carico)
 *  3. cosa è in ritardo adesso e va sollecitato? (righe scadute)
 *
 * I dati vengono da /api/bi/acquisti, non dal motore semantico delle vendite:
 * il buyer non è un agente e il fornitore non è un cliente, e forzarli nelle
 * stesse dimensioni offrirebbe filtri che non vogliono dire niente.
 */

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiEroe, PALETTE, Scheda, Scheletro, euro, numero, percentuale } from "./primitivi";
import type { CruscottoAcquisti } from "@/lib/prototipo-bi/acquisti";
import type { Periodo } from "@/lib/prototipo-bi/tipi";

const ASSE = { fontSize: 11, fill: "#64748b" };
const BUYER_IN_GRAFICO = 4;

function gg(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })} gg`;
}

function pct(n: number | null): string {
  return n === null ? "—" : percentuale(n);
}

function dataBreve(iso: string): string {
  const [a, m, g] = iso.split("-");
  return `${g}/${m}/${a.slice(2)}`;
}

/** Verde, giallo, rosso: la soglia è quella che un buyer considera "va bene". */
function colorePuntualita(n: number | null): string {
  if (n === null) return "text-text-muted";
  if (n >= 90) return "text-success";
  if (n >= 75) return "text-warning";
  return "text-danger";
}

export function VistaAcquisti({ anno, periodo }: { anno: number; periodo: Periodo }) {
  const dal = periodo.dal ?? `${anno}-01-01`;
  const al = periodo.al ?? `${anno}-12-31`;
  const [dati, setDati] = useState<CruscottoAcquisti | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    setDati(null);
    setErrore(null);
    fetch(`/api/bi/acquisti?dal=${dal}&al=${al}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Errore");
        if (!annullato) setDati(j as CruscottoAcquisti);
      })
      .catch((e) => !annullato && setErrore(e instanceof Error ? e.message : "Errore"));
    return () => {
      annullato = true;
    };
  }, [dal, al]);

  // I buyer principali per colore, il resto insieme: un grafico impilato con
  // sette colori per tre righe al mese non si legge.
  const { buyerGrafico, datiCarico } = useMemo(() => {
    if (!dati) return { buyerGrafico: [] as string[], datiCarico: [] as Record<string, string | number>[] };
    const principali = dati.perBuyer.slice(0, BUYER_IN_GRAFICO).map((b) => b.nome);
    const conAltri = [...principali, "Altri"];
    const righe = dati.caricoSettimanale.map((s) => {
      const riga: Record<string, string | number> = { settimana: dataBreve(s.settimana) };
      for (const b of principali) riga[b] = s.perBuyer[b] ?? 0;
      riga["Altri"] = Object.entries(s.perBuyer)
        .filter(([b]) => !principali.includes(b))
        .reduce((t, [, n]) => t + n, 0);
      return riga;
    });
    return { buyerGrafico: conAltri, datiCarico: righe };
  }, [dati]);

  if (errore) {
    return (
      <Scheda titolo="Acquisti">
        <p className="text-sm text-danger">{errore}</p>
      </Scheda>
    );
  }
  if (!dati) return <Scheletro altezza={420} />;

  const t = dati.totale;
  return (
    <div className="space-y-4">
      <Scheda
        titolo="Ufficio acquisti"
        sottotitolo={`Ordini a fornitore dal ${dataBreve(dati.periodo.dal)} al ${dataBreve(dati.periodo.al)} · situazione aperta al ${dataBreve(dati.oggi)}`}
        info="Puntuale = arrivata entro la data confermata dal fornitore (o la prevista, se manca). L'arrivo è la data del DDT del fornitore. La puntualità si misura sulle righe ARRIVATE nel periodo, anche se ordinate prima."
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiEroe etichetta="Righe ordinate" valore={t.righe} unita="numero" nota={`${numero(t.ordini)} ordini`} />
          <KpiEroe etichetta="Valore ordinato" valore={t.valore} unita="euro" />
          <KpiEroe
            etichetta="Puntualità fornitori"
            valore={t.puntualitaPct}
            unita="percentuale"
            nota={`${numero(t.righeArrivate)} righe arrivate`}
          />
          <KpiEroe etichetta="Ordine → arrivo" valore={t.tempoConsegnaGiorni} unita="giorni" nota="media delle righe arrivate" />
          <KpiEroe
            etichetta="Righe scadute"
            valore={t.righeScadute}
            unita="numero"
            nota={`${euro(t.valoreScaduto)} ancora da ricevere`}
          />
        </div>
        {dati.avvisi.length > 0 && (
          <ul className="mt-3 space-y-1">
            {dati.avvisi.map((a) => (
              <li key={a} className="text-xs text-text-muted flex gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                {a}
              </li>
            ))}
          </ul>
        )}
      </Scheda>

      <Scheda
        titolo="Carico di lavoro"
        sottotitolo="Righe d'ordine emesse per settimana, ultime 26 settimane"
        info="Ogni riga d'ordine è un articolo ordinato a un fornitore: è l'unità di lavoro che il gestionale registra. Il buyer è l'utente che ha creato l'ordine."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={datiCarico} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="settimana" tick={ASSE} minTickGap={16} />
            <YAxis tick={ASSE} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {buyerGrafico.map((b, i) => (
              <Bar key={b} dataKey={b} stackId="carico" fill={b === "Altri" ? "#cbd5e1" : PALETTE[i % PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Scheda>

      <Scheda titolo="Per buyer" sottotitolo="Volume nel periodo e situazione aperta oggi">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-text-muted border-b border-border font-tenorite">
                <th className="py-2 pr-3">Buyer</th>
                <th className="py-2 px-2 text-right">Righe</th>
                <th className="py-2 px-2 text-right">Quota</th>
                <th className="py-2 px-2 text-right">Ordini</th>
                <th className="py-2 px-2 text-right">Valore</th>
                <th className="py-2 px-2 text-right">Puntualità</th>
                <th className="py-2 px-2 text-right">Ordine → arrivo</th>
                <th className="py-2 px-2 text-right">Aperte</th>
                <th className="py-2 pl-2 text-right">Scadute</th>
              </tr>
            </thead>
            <tbody>
              {dati.perBuyer.map((b) => (
                <tr key={b.nome} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">{b.nome}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{numero(b.righe)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{percentuale(b.quotaRighePct)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{numero(b.ordini)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{euro(b.valore)}</td>
                  <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${colorePuntualita(b.puntualitaPct)}`}>
                    {pct(b.puntualitaPct)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{gg(b.tempoConsegnaGiorni)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{numero(b.righeAperte)}</td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums ${b.righeScadute > 0 ? "text-danger font-medium" : ""}`}>
                    {numero(b.righeScadute)}
                    {b.valoreScaduto > 0 && <span className="text-text-muted font-normal"> · {euro(b.valoreScaduto)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Scheda>

      <Scheda
        titolo="Fornitori"
        sottotitolo="I 25 con più valore ordinato nel periodo"
        info="«Prima» è la puntualità dei 12 mesi precedenti al periodo, se il fornitore ha almeno 10 righe arrivate: dice se sta peggiorando."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-text-muted border-b border-border font-tenorite">
                <th className="py-2 pr-3">Fornitore</th>
                <th className="py-2 px-2 text-right">Valore</th>
                <th className="py-2 px-2 text-right">Righe</th>
                <th className="py-2 px-2 text-right">Puntualità</th>
                <th className="py-2 px-2 text-right">Prima</th>
                <th className="py-2 px-2 text-right">Ritardo medio</th>
                <th className="py-2 px-2 text-right">Ordine → arrivo</th>
                <th className="py-2 pl-2 text-right">Scadute</th>
              </tr>
            </thead>
            <tbody>
              {dati.perFornitore.slice(0, 25).map((f) => {
                const peggiora =
                  f.puntualitaPct !== null && f.puntualitaPrimaPct !== null && f.puntualitaPrimaPct - f.puntualitaPct >= 10;
                return (
                  <tr key={f.nome} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 truncate max-w-[260px]" title={f.nome}>{f.nome}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{euro(f.valore)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{numero(f.righe)}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${colorePuntualita(f.puntualitaPct)}`}>
                      {pct(f.puntualitaPct)}
                      {peggiora && <span className="ml-1 text-danger" title="In calo di almeno 10 punti">▼</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-text-muted">{pct(f.puntualitaPrimaPct)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{gg(f.ritardoMedioGiorni)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{gg(f.tempoConsegnaGiorni)}</td>
                    <td className={`py-1.5 pl-2 text-right tabular-nums ${f.righeScadute > 0 ? "text-danger" : ""}`}>
                      {numero(f.righeScadute)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Scheda>

      <Scheda
        titolo="Da sollecitare"
        sottotitolo={`${numero(dati.scadute.length)} righe con la data promessa passata e merce non ancora arrivata`}
        info="Ordinate per giorni di ritardo per valore ancora da ricevere: in cima quello che pesa di più."
      >
        {dati.scadute.length === 0 ? (
          <p className="text-sm text-text-muted">Nessuna riga scaduta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-text-muted border-b border-border font-tenorite">
                  <th className="py-2 pr-3">Fornitore</th>
                  <th className="py-2 px-2">Articolo</th>
                  <th className="py-2 px-2">Buyer</th>
                  <th className="py-2 px-2 text-right">Ordine</th>
                  <th className="py-2 px-2 text-right">Promessa</th>
                  <th className="py-2 px-2 text-right">Ritardo</th>
                  <th className="py-2 pl-2 text-right">Da ricevere</th>
                </tr>
              </thead>
              <tbody>
                {dati.scadute.slice(0, 20).map((s, i) => (
                  <tr key={`${s.ordine}-${s.articolo}-${i}`} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 truncate max-w-[200px]" title={s.fornitore}>{s.fornitore}</td>
                    <td className="py-1.5 px-2 truncate max-w-[260px]" title={s.descrizione}>
                      <span className="font-mono text-xs">{s.articolo}</span>{" "}
                      <span className="text-text-muted">{s.descrizione}</span>
                    </td>
                    <td className="py-1.5 px-2">{s.buyer}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {s.ordine ?? "—"} <span className="text-text-muted">del {dataBreve(s.dataOrdine)}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{dataBreve(s.promessa)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-danger font-medium">{gg(s.giorniRitardo)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{euro(s.valoreResiduo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Scheda>
    </div>
  );
}
