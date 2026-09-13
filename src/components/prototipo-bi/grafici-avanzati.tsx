"use client";

/**
 *
 * Grafici analitici — quelli che il PBIX non ha e che servono per ragionare,
 * non solo per guardare.
 *
 * Ognuno risponde a una domanda precisa:
 *   Waterfall  → "da dove viene la differenza?"
 *   Pareto     → "quanto dipendo da pochi?"
 *   Bullet     → "sono sopra o sotto il mio obiettivo?"
 *   Heatmap    → "dove e quando si è rotto qualcosa?"
 *   Quadranti  → "chi merita attenzione?"
 *   Multipli   → "tutte le business unit, in un colpo d'occhio"
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { euro, numero, PALETTE, Vuoto } from "./primitivi";
import { useImpostazioni } from "./impostazioni";

const ASSE = { fontSize: 11, fill: "#64748b" };
const GRIGLIA = "#e2e8f0";

const VERDE = "#22c55e";
const ROSSO = "#ef4444";
const NEUTRO = "#94a3b8";
const AMBRA = "#f59e0b";

function pct(parte: number, tot: number) {
  return tot ? (parte / tot) * 100 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip ricco condiviso
// ─────────────────────────────────────────────────────────────────────────────

interface VoceTooltip {
  etichetta: string;
  valore: string;
  colore?: string;
}

function Riquadro({ titolo, voci }: { titolo: string; voci: VoceTooltip[] }) {
  return (
    <div className="rounded-lg border border-border bg-bg shadow-lg px-3 py-2 text-xs">
      <div className="font-tenorite font-semibold mb-1.5 text-text">{titolo}</div>
      <div className="space-y-1">
        {voci.map((v, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-text-muted">
              {v.colore && (
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ background: v.colore }}
                />
              )}
              {v.etichetta}
            </span>
            <span className="tabular-nums font-medium text-text">{v.valore}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. WATERFALL — "da dove viene la differenza?"
// ─────────────────────────────────────────────────────────────────────────────

export interface VoceWaterfall {
  etichetta: string;
  delta: number;
}

/**
 * Scompone la differenza fra due totali nei suoi contributi.
 * È il grafico che trasforma "l'ordinato è calato di 480 k€" in
 * "COSTRUITO −473 k€, COMPONENTI −251 k€, IMPIANTI +38 k€".
 */
export function Waterfall({
  partenza,
  arrivo,
  voci,
  etichettaPartenza = "Inizio",
  etichettaArrivo = "Fine",
  altezza = 320,
  onClickVoce,
}: {
  partenza: number;
  arrivo: number;
  voci: VoceWaterfall[];
  etichettaPartenza?: string;
  etichettaArrivo?: string;
  altezza?: number;
  onClickVoce?: (etichetta: string) => void;
}) {
  const { palette, imp, durata } = useImpostazioni();
  const dati = useMemo(() => {
    const ordinate = [...voci].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const out: {
      nome: string;
      base: number;
      valore: number;
      delta: number;
      tipo: "totale" | "aumento" | "diminuzione";
    }[] = [];

    out.push({
      nome: etichettaPartenza,
      base: 0,
      valore: partenza,
      delta: partenza,
      tipo: "totale",
    });

    let cursore = partenza;
    for (const v of ordinate) {
      const base = v.delta >= 0 ? cursore : cursore + v.delta;
      out.push({
        nome: v.etichetta,
        base,
        valore: Math.abs(v.delta),
        delta: v.delta,
        tipo: v.delta >= 0 ? "aumento" : "diminuzione",
      });
      cursore += v.delta;
    }

    out.push({ nome: etichettaArrivo, base: 0, valore: arrivo, delta: arrivo, tipo: "totale" });
    return out;
  }, [partenza, arrivo, voci, etichettaPartenza, etichettaArrivo]);

  if (voci.length === 0) return <Vuoto altezza={altezza} />;

  const scarto = arrivo - partenza;

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <span className="text-xs text-text-muted">Variazione totale</span>
        <span
          className={`font-tenorite font-bold text-lg ${scarto >= 0 ? "text-success" : "text-danger"}`}
        >
          {scarto >= 0 ? "+" : ""}
          {euro(scarto, false)}
        </span>
        <span className="text-xs text-text-muted">
          ({scarto >= 0 ? "+" : ""}
          {pct(scarto, partenza).toFixed(1)}%)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={altezza}>
        <BarChart data={dati} margin={{ left: 0, right: 12, top: 8, bottom: 40 }}>
          {imp.mostraGriglia && (
            <CartesianGrid strokeDasharray="3 3" stroke={GRIGLIA} vertical={false} />
          )}
          <XAxis
            dataKey="nome"
            tick={ASSE}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={70}
          />
          <YAxis tick={ASSE} tickFormatter={(v) => euro(v)} />
          <Tooltip
            cursor={{ fill: "rgba(0,161,190,0.06)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof dati)[number];
              return (
                <Riquadro
                  titolo={d.nome}
                  voci={
                    d.tipo === "totale"
                      ? [{ etichetta: "Totale", valore: euro(d.valore, false) }]
                      : [
                          {
                            etichetta: "Contributo",
                            valore: `${d.delta >= 0 ? "+" : ""}${euro(d.delta, false)}`,
                            colore: d.delta >= 0 ? VERDE : ROSSO,
                          },
                          {
                            etichetta: "Quota della variazione",
                            valore: `${pct(Math.abs(d.delta), Math.abs(scarto)).toFixed(1)}%`,
                          },
                        ]
                  }
                />
              );
            }}
          />
          {/* Base trasparente: è ciò che fa "galleggiare" le barre. */}
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="valore"
            stackId="w"
            radius={[imp.arrotondamento, imp.arrotondamento, 0, 0]}
            animationDuration={durata}
            onClick={(d: unknown) => {
              const p = d as { nome?: string; tipo?: string };
              if (onClickVoce && p.tipo !== "totale" && p.nome) onClickVoce(p.nome);
            }}
            cursor={onClickVoce ? "pointer" : undefined}
          >
            {dati.map((d, i) => (
              <Cell
                key={i}
                fill={
                  d.tipo === "totale"
                    ? "#334155"
                    : d.tipo === "aumento"
                      ? palette.positivo
                      : palette.negativo
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PARETO — "quanto dipendo da pochi?"
// ─────────────────────────────────────────────────────────────────────────────

export function Pareto({
  dati,
  altezza = 320,
  massimo = 20,
  onClick,
}: {
  dati: { etichetta: string; valore: number }[];
  altezza?: number;
  massimo?: number;
  onClick?: (etichetta: string) => void;
}) {
  const { palette, imp, durata } = useImpostazioni();
  const elaborati = useMemo(() => {
    const ordinati = [...dati].sort((a, b) => b.valore - a.valore);
    const totale = ordinati.reduce((s, d) => s + d.valore, 0);
    let acc = 0;
    return ordinati.slice(0, massimo).map((d) => {
      acc += d.valore;
      return {
        nome: d.etichetta.length > 20 ? `${d.etichetta.slice(0, 19)}…` : d.etichetta,
        nomeCompleto: d.etichetta,
        valore: d.valore,
        cumulata: pct(acc, totale),
        quota: pct(d.valore, totale),
      };
    });
  }, [dati, massimo]);

  const indice80 = elaborati.findIndex((d) => d.cumulata >= 80);
  if (elaborati.length === 0) return <Vuoto altezza={altezza} />;

  return (
    <div>
      {indice80 >= 0 && (
        <p className="text-xs text-text-muted mb-2">
          <strong className="text-text">{indice80 + 1}</strong> voci su {dati.length} fanno
          l&apos;<strong className="text-text">80%</strong> del totale
        </p>
      )}
      <ResponsiveContainer width="100%" height={altezza}>
        <ComposedChart data={elaborati} margin={{ left: 0, right: 8, top: 8, bottom: 50 }}>
          {imp.mostraGriglia && (
            <CartesianGrid strokeDasharray="3 3" stroke={GRIGLIA} vertical={false} />
          )}
          <XAxis dataKey="nome" tick={ASSE} interval={0} angle={-35} textAnchor="end" height={80} />
          <YAxis yAxisId="v" tick={ASSE} tickFormatter={(v) => euro(v)} />
          <YAxis
            yAxisId="c"
            orientation="right"
            domain={[0, 100]}
            tick={ASSE}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,161,190,0.06)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof elaborati)[number];
              return (
                <Riquadro
                  titolo={d.nomeCompleto}
                  voci={[
                    { etichetta: "Valore", valore: euro(d.valore, false), colore: PALETTE[0] },
                    { etichetta: "Quota", valore: `${d.quota.toFixed(1)}%` },
                    { etichetta: "Cumulata", valore: `${d.cumulata.toFixed(1)}%`, colore: AMBRA },
                  ]}
                />
              );
            }}
          />
          <ReferenceLine yAxisId="c" y={80} stroke={palette.obiettivo} strokeDasharray="4 4">
            <Label value="80%" position="right" fontSize={10} fill={palette.obiettivo} />
          </ReferenceLine>
          <Bar
            yAxisId="v"
            dataKey="valore"
            radius={[imp.arrotondamento, imp.arrotondamento, 0, 0]}
            animationDuration={durata}
            cursor={onClick ? "pointer" : undefined}
            onClick={(d: unknown) => {
              const p = d as { nomeCompleto?: string };
              if (onClick && p.nomeCompleto) onClick(p.nomeCompleto);
            }}
          >
            {elaborati.map((d, i) => (
              <Cell key={i} fill={indice80 >= 0 && i <= indice80 ? palette.serie[0] : "#cbd5e1"} />
            ))}
          </Bar>
          <Line
            yAxisId="c"
            type="monotone"
            dataKey="cumulata"
            stroke={palette.obiettivo}
            strokeWidth={2}
            dot={{ r: 2 }}
            animationDuration={durata}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BULLET — "sono sopra o sotto obiettivo?"
// ─────────────────────────────────────────────────────────────────────────────

export interface RigaBullet {
  etichetta: string;
  valore: number;
  obiettivo: number;
  soglia?: number | null; // il BEP
}

/**
 * Un bullet chart per riga. Sostituisce i gauge del PBIX, che occupano
 * mezza pagina per mostrare un numero: qui otto business unit stanno
 * nello spazio di un gauge e si confrontano a colpo d'occhio.
 */
export function Bullet({
  righe,
  onClick,
}: {
  righe: RigaBullet[];
  onClick?: (etichetta: string) => void;
}) {
  const { imp } = useImpostazioni();
  if (righe.length === 0) return <Vuoto altezza={160} />;

  const scalaMax = Math.max(
    ...righe.map((r) => Math.max(r.valore, r.obiettivo, r.soglia ?? 0))
  );

  return (
    <div className="space-y-3">
      {righe.map((r) => {
        const raggiungimento = r.obiettivo ? (r.valore / r.obiettivo) * 100 : 0;
        const sopraObiettivo = r.valore >= r.obiettivo;
        const sottoSoglia = r.soglia != null && r.soglia > 0 && r.valore < r.soglia;

        return (
          <div
            key={r.etichetta}
            className={`${onClick ? "cursor-pointer hover:bg-bg-page rounded-lg -mx-2 px-2 py-1 transition-colors" : ""}`}
            onClick={() => onClick?.(r.etichetta)}
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-sm font-medium truncate" title={r.etichetta}>
                {r.etichetta}
              </span>
              <span className="text-xs tabular-nums shrink-0">
                <span className="font-semibold">{euro(r.valore, imp.numeriCompatti)}</span>
                <span className="text-text-muted"> / {euro(r.obiettivo, imp.numeriCompatti)}</span>
                <span
                  className={`ml-2 font-semibold ${
                    sopraObiettivo ? "text-success" : sottoSoglia ? "text-danger" : "text-warning"
                  }`}
                >
                  {raggiungimento.toFixed(0)}%
                </span>
              </span>
            </div>

            <div className="relative h-5 rounded bg-bg-page overflow-hidden">
              {/* Fasce di riferimento: fino al BEP, dal BEP al budget, oltre. */}
              {r.soglia != null && r.soglia > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-slate-200/70"
                  style={{ width: `${Math.min(100, (r.soglia / scalaMax) * 100)}%` }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 bg-slate-100"
                style={{
                  left: `${Math.min(100, ((r.soglia ?? 0) / scalaMax) * 100)}%`,
                  width: `${Math.max(0, ((r.obiettivo - (r.soglia ?? 0)) / scalaMax) * 100)}%`,
                }}
              />
              {/* La misura */}
              <div
                className={`absolute top-1.5 bottom-1.5 left-0 rounded-r transition-all duration-700 ${
                  sopraObiettivo ? "bg-success" : sottoSoglia ? "bg-danger" : "bg-primary"
                }`}
                style={{ width: `${Math.min(100, (r.valore / scalaMax) * 100)}%` }}
              />
              {/* Marcatore obiettivo */}
              <div
                className="absolute inset-y-0 w-0.5 bg-slate-800"
                style={{ left: `${Math.min(100, (r.obiettivo / scalaMax) * 100)}%` }}
                title={`Budget ${euro(r.obiettivo)}`}
              />
              {r.soglia != null && r.soglia > 0 && (
                <div
                  className="absolute inset-y-0 w-0.5 bg-danger/60"
                  style={{ left: `${Math.min(100, (r.soglia / scalaMax) * 100)}%` }}
                  title={`BEP ${euro(r.soglia)}`}
                />
              )}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 pt-1 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-slate-800 inline-block" /> budget
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-danger/60 inline-block" /> BEP
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HEATMAP — "dove e quando?"
// ─────────────────────────────────────────────────────────────────────────────

export function Heatmap({
  righe,
  colonne,
  valori,
  formato = "euro",
  divergente = false,
  onClick,
}: {
  righe: string[];
  colonne: string[];
  /** valori[riga][colonna] */
  valori: Record<string, Record<string, number>>;
  formato?: "euro" | "percentuale";
  /** true = scala rosso/verde centrata sullo zero (per gli scostamenti) */
  divergente?: boolean;
  onClick?: (riga: string, colonna: string) => void;
}) {
  const { palette, imp } = useImpostazioni();
  const { min, max, assoluto } = useMemo(() => {
    const tutti: number[] = [];
    for (const r of righe) for (const c of colonne) tutti.push(valori[r]?.[c] ?? 0);
    const mn = Math.min(...tutti, 0);
    const mx = Math.max(...tutti, 0);
    return { min: mn, max: mx, assoluto: Math.max(Math.abs(mn), Math.abs(mx)) };
  }, [righe, colonne, valori]);

  if (righe.length === 0 || colonne.length === 0) return <Vuoto altezza={200} />;

  function colore(v: number): string {
    if (divergente) {
      if (assoluto === 0) return "rgba(148,163,184,0.15)";
      const i = Math.min(1, Math.abs(v) / assoluto);
      return v >= 0
        ? `rgba(34,197,94,${0.12 + i * 0.68})`
        : `rgba(239,68,68,${0.12 + i * 0.68})`;
    }
    const span = max - min || 1;
    const i = (v - min) / span;
    // Colore della palette in esadecimale, con opacita proporzionale.
    const alfa = Math.round((0.08 + i * 0.75) * 255).toString(16).padStart(2, "0");
    return `${palette.serie[0]}${alfa}`;
  }

  const fmt = (v: number) =>
    formato === "euro" ? euro(v, imp.numeriCompatti) : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-left text-[10px] uppercase text-text-muted font-tenorite pr-2 sticky left-0 bg-bg" />
            {colonne.map((c) => (
              <th
                key={c}
                className="text-[10px] uppercase text-text-muted font-tenorite px-1 pb-1 whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r}>
              <td className="text-xs font-medium pr-3 whitespace-nowrap sticky left-0 bg-bg max-w-[160px] truncate">
                {r}
              </td>
              {colonne.map((c) => {
                const v = valori[r]?.[c] ?? 0;
                return (
                  <td key={c}>
                    <div
                      className={`rounded text-[10px] tabular-nums text-center py-1.5 px-1.5 whitespace-nowrap transition-transform ${
                        onClick ? "cursor-pointer hover:scale-105" : ""
                      }`}
                      style={{ background: colore(v), minWidth: 56 }}
                      title={`${r} · ${c}: ${fmt(v)}`}
                      onClick={() => onClick?.(r, c)}
                    >
                      {v === 0 ? "—" : fmt(v)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. QUADRANTI — "chi merita attenzione?"
// ─────────────────────────────────────────────────────────────────────────────

export function Quadranti({
  punti,
  etichettaX = "Valore anno precedente",
  etichettaY = "Variazione %",
  altezza = 380,
  onClick,
}: {
  punti: { nome: string; x: number; y: number; dimensione?: number }[];
  etichettaX?: string;
  etichettaY?: string;
  altezza?: number;
  onClick?: (nome: string) => void;
}) {
  const { palette, imp, durata } = useImpostazioni();
  // Gli hook vanno prima di qualsiasi uscita anticipata.
  const medianaX = useMemo(() => {
    const v = punti.map((p) => p.x).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 0;
  }, [punti]);

  if (punti.length === 0) return <Vuoto altezza={altezza} />;

  const dati = punti.map((p) => ({
    ...p,
    z: p.dimensione ?? Math.abs(p.x),
    colore: p.y >= 0 ? palette.positivo : palette.negativo,
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-2 text-[11px] text-text-muted">
        <span>↖ piccoli in crescita — da coltivare</span>
        <span>↗ grandi in crescita — da proteggere</span>
        <span>↙ piccoli in calo — da valutare</span>
        <span className="text-danger font-medium">↘ grandi in calo — priorità</span>
      </div>
      <ResponsiveContainer width="100%" height={altezza}>
        <ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 20 }}>
          {imp.mostraGriglia && <CartesianGrid strokeDasharray="3 3" stroke={GRIGLIA} />}
          <XAxis
            type="number"
            dataKey="x"
            name={etichettaX}
            tick={ASSE}
            tickFormatter={(v) => euro(v)}
          >
            <Label value={etichettaX} position="insideBottom" offset={-12} fontSize={11} fill="#64748b" />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            name={etichettaY}
            tick={ASSE}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
          />
          <ZAxis type="number" dataKey="z" range={[40, 420]} />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
          <ReferenceLine x={medianaX} stroke="#94a3b8" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof dati)[number];
              return (
                <Riquadro
                  titolo={d.nome}
                  voci={[
                    { etichetta: etichettaX, valore: euro(d.x, false) },
                    {
                      etichetta: etichettaY,
                      valore: `${d.y >= 0 ? "+" : ""}${d.y.toFixed(1)}%`,
                      colore: d.colore,
                    },
                  ]}
                />
              );
            }}
          />
          <Scatter
            data={dati}
            animationDuration={durata}
            cursor={onClick ? "pointer" : undefined}
            onClick={(d: unknown) => {
              const p = d as { nome?: string };
              if (onClick && p.nome) onClick(p.nome);
            }}
          >
            {dati.map((d, i) => (
              <Cell key={i} fill={d.colore} fillOpacity={0.65} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SPARKLINE — per le tabelle
// ─────────────────────────────────────────────────────────────────────────────

export function Sparkline({
  valori,
  larghezza = 90,
  altezza = 26,
  colore,
}: {
  valori: number[];
  larghezza?: number;
  altezza?: number;
  colore?: string;
}) {
  const { palette } = useImpostazioni();
  if (valori.length < 2) return <span className="text-text-muted text-xs">—</span>;

  const tendenza = valori[valori.length - 1] - valori[0];
  const c = colore ?? (tendenza >= 0 ? palette.positivo : palette.negativo);
  const dati = valori.map((v, i) => ({ i, v }));
  const id = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div style={{ width: larghezza, height: altezza }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dati} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.35} />
              <stop offset="100%" stopColor={c} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={c}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. MULTIPLI — tutte le serie in un colpo d'occhio
// ─────────────────────────────────────────────────────────────────────────────

export function Multipli({
  serie,
  onClick,
}: {
  serie: {
    nome: string;
    valori: { periodo: string; valore: number }[];
    totale: number;
    variazionePct?: number | null;
  }[];
  onClick?: (nome: string) => void;
}) {
  const { palette, imp } = useImpostazioni();
  if (serie.length === 0) return <Vuoto altezza={180} />;

  // Scala comune: senza, un grafichino con picchi da 10 k€ sembra identico a
  // uno da 2 M€ e il confronto visivo mente.
  const massimo = Math.max(...serie.flatMap((s) => s.valori.map((v) => v.valore)), 1);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {serie.map((s) => (
        <button
          key={s.nome}
          onClick={() => onClick?.(s.nome)}
          className={`text-left rounded-lg border border-border p-3 ${
            onClick ? "hover:border-primary hover:shadow-sm transition-all" : ""
          }`}
        >
          <div className="text-xs font-medium truncate mb-0.5" title={s.nome}>
            {s.nome}
          </div>
          <div className="font-tenorite font-bold text-base">
            {euro(s.totale, imp.numeriCompatti)}
          </div>
          {s.variazionePct != null && (
            <div
              className={`text-[11px] font-medium ${
                s.variazionePct >= 0 ? "text-success" : "text-danger"
              }`}
            >
              {s.variazionePct >= 0 ? "▲" : "▼"} {Math.abs(s.variazionePct).toFixed(1)}%
            </div>
          )}
          <div className="mt-1.5 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={s.valori.map((v) => ({ ...v }))}
                margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
              >
                <YAxis hide domain={[0, massimo]} />
                <Area
                  type="monotone"
                  dataKey="valore"
                  stroke={palette.serie[0]}
                  strokeWidth={1.5}
                  fill={palette.serie[0]}
                  fillOpacity={0.15}
                  dot={false}
                  isAnimationActive={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { periodo: string; valore: number };
                    return (
                      <Riquadro
                        titolo={`${s.nome} · ${d.periodo}`}
                        voci={[{ etichetta: "Valore", valore: euro(d.valore, false) }]}
                      />
                    );
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. BARRE DI SCOSTAMENTO — positivo/negativo attorno allo zero
// ─────────────────────────────────────────────────────────────────────────────

export function BarreScostamento({
  dati,
  altezza = 280,
  formato = "euro",
  onClick,
}: {
  dati: { etichetta: string; valore: number }[];
  altezza?: number;
  formato?: "euro" | "percentuale";
  onClick?: (etichetta: string) => void;
}) {
  const { palette, imp, durata } = useImpostazioni();
  if (dati.length === 0) return <Vuoto altezza={altezza} />;
  const ordinati = [...dati].sort((a, b) => b.valore - a.valore).slice(0, imp.topN);
  const fmt = (v: number) =>
    formato === "euro" ? euro(v, imp.numeriCompatti) : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <BarChart data={ordinati} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        {imp.mostraGriglia && (
          <CartesianGrid strokeDasharray="3 3" stroke={GRIGLIA} horizontal={false} />
        )}
        <XAxis type="number" tick={ASSE} tickFormatter={fmt} />
        <YAxis type="category" dataKey="etichetta" tick={ASSE} width={130} />
        <ReferenceLine x={0} stroke="#334155" />
        <Tooltip
          cursor={{ fill: "rgba(0,161,190,0.06)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { etichetta: string; valore: number };
            return (
              <Riquadro
                titolo={d.etichetta}
                voci={[
                  {
                    etichetta: "Scostamento",
                    valore: fmt(d.valore),
                    colore: d.valore >= 0 ? VERDE : ROSSO,
                  },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="valore"
          radius={[0, imp.arrotondamento, imp.arrotondamento, 0]}
          animationDuration={durata}
          cursor={onClick ? "pointer" : undefined}
          onClick={(d: unknown) => {
            const p = d as { etichetta?: string };
            if (onClick && p.etichetta) onClick(p.etichetta);
          }}
        >
          {ordinati.map((d, i) => (
            <Cell key={i} fill={d.valore >= 0 ? palette.positivo : palette.negativo} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export { Riquadro, NEUTRO, VERDE, ROSSO, AMBRA, numero };
