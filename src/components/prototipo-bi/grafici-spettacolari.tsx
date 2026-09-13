"use client";

/**
 *
 * Grafici ad alto impatto visivo. Nessuno è decorativo: ognuno esiste perché
 * risponde a una domanda che gli altri non riescono a mostrare bene.
 *
 *   Imbuto      → quanto si perde fra preventivo e ordine
 *   Radiale     → un solo numero contro il suo obiettivo, in grande
 *   Treemap     → composizione a due livelli in un colpo d'occhio
 *   Calendario  → il ritmo di lavoro giorno per giorno
 *   Aree        → come si distribuisce il carico fra le persone nel tempo
 *   Anelli      → confronto compatto di più percentuali
 */

import { useId, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { valoreFmt, Vuoto } from "./primitivi";
import { useImpostazioni } from "./impostazioni";
import type { UnitaMisura } from "@/lib/prototipo-bi/tipi";

function Riquadro({
  titolo,
  voci,
}: {
  titolo: string;
  voci: { etichetta: string; valore: string; colore?: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-bg shadow-lg px-3 py-2 text-xs">
      <div className="font-tenorite font-semibold mb-1.5 text-text">{titolo}</div>
      <div className="space-y-1">
        {voci.map((v, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-text-muted">
              {v.colore && (
                <span className="w-2 h-2 rounded-full" style={{ background: v.colore }} />
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
// 1. IMBUTO — "quanto si perde per strada?"
// ─────────────────────────────────────────────────────────────────────────────

export interface FaseImbuto {
  etichetta: string;
  valore: number;
  nota?: string;
}

/** Luminanza percepita di un colore esadecimale, per scegliere il testo. */
function luminanza(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Imbuto a trapezi proporzionali. A differenza dell'imbuto decorativo che si
 * vede spesso, la larghezza è davvero proporzionale al valore: la perdita fra
 * una fase e l'altra si legge nella geometria, non solo nell'etichetta.
 *
 * Ogni fase ha la SUA banda: le prime N-1 sono trapezi che si restringono
 * verso la fase successiva, l'ultima è un rettangolo. Disegnare solo i
 * trapezi di transizione (N-1 forme per N etichette) lasciava l'ultima fase
 * fuori dalla figura, con il testo bianco su fondo bianco.
 */
export function Imbuto({
  fasi,
  unita = "euro",
  altezza = 300,
  onClick,
}: {
  fasi: FaseImbuto[];
  unita?: UnitaMisura;
  altezza?: number;
  onClick?: (etichetta: string) => void;
}) {
  const { palette, imp, durata } = useImpostazioni();
  const fmt = (n: number) => valoreFmt(n, unita, imp.numeriCompatti);

  if (fasi.length < 2) return <Vuoto altezza={altezza} />;

  const massimo = Math.max(...fasi.map((f) => f.valore), 1);
  const altezzaFase = altezza / fasi.length;
  const larghezza = (v: number) => Math.max(4, (v / massimo) * 100);

  const bande = fasi.map((f, i) => {
    const sopra = larghezza(f.valore);
    // L'ultima fase non si restringe verso nulla: resta della sua larghezza.
    const sotto = i < fasi.length - 1 ? larghezza(fasi[i + 1].valore) : sopra;
    const tinta = palette.serie[i % palette.serie.length];
    return {
      ...f,
      sopra,
      sotto,
      tinta,
      // Le bande sfumano scendendo: il testo va scelto sul colore effettivo.
      opacita: Math.max(0.55, 0.92 - i * 0.14),
      chiaro: luminanza(tinta) < 0.5,
    };
  });

  return (
    <div>
      <div style={{ height: altezza }} className="relative">
        <svg
          width="100%"
          height={altezza}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0"
        >
          {bande.map((b, i) => {
            const y1 = (i / fasi.length) * 100;
            const y2 = ((i + 1) / fasi.length) * 100;
            const x1 = (100 - b.sopra) / 2;
            const x2 = (100 - b.sotto) / 2;
            return (
              <motion.polygon
                key={b.etichetta}
                initial={durata ? { opacity: 0 } : false}
                animate={{ opacity: b.opacita }}
                transition={{ duration: durata / 1000, delay: i * 0.08 }}
                points={`${x1},${y1} ${x1 + b.sopra},${y1} ${x2 + b.sotto},${y2} ${x2},${y2}`}
                fill={b.tinta}
                stroke="white"
                strokeWidth={0.3}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: onClick ? "pointer" : undefined }}
                onClick={() => onClick?.(b.etichetta)}
              />
            );
          })}
        </svg>

        {/* Le etichette stanno sopra l'SVG: così restano leggibili senza
            deformarsi con il preserveAspectRatio="none". */}
        <div className="absolute inset-0 flex flex-col pointer-events-none">
          {bande.map((b, i) => {
            const prec = i > 0 ? fasi[i - 1].valore : null;
            const perdita = prec && prec > 0 ? ((b.valore - prec) / prec) * 100 : null;
            const testo = b.chiaro ? "text-white" : "text-slate-900";
            const ombra = b.chiaro ? "drop-shadow" : "";
            return (
              <div
                key={b.etichetta}
                style={{ height: altezzaFase }}
                className="flex items-center justify-center"
              >
                <div className={`text-center px-2 ${testo} ${ombra}`}>
                  <div className="text-[11px] uppercase tracking-wide font-tenorite opacity-90">
                    {b.etichetta}
                  </div>
                  <div className="font-tenorite font-bold text-lg leading-tight">
                    {fmt(b.valore)}
                  </div>
                  {perdita !== null && (
                    <div className="text-[11px] font-medium opacity-90">
                      {perdita >= 0 ? "+" : ""}
                      {perdita.toFixed(1)}%
                      {b.nota ? ` · ${b.nota}` : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RADIALE — "un numero contro il suo obiettivo"
// ─────────────────────────────────────────────────────────────────────────────

export function Radiale({
  valore,
  obiettivo,
  etichetta,
  unita = "euro",
  dimensione = 190,
  soglia,
}: {
  valore: number;
  obiettivo: number;
  etichetta: string;
  unita?: UnitaMisura;
  dimensione?: number;
  soglia?: number | null;
}) {
  const { palette, imp, durata } = useImpostazioni();
  const id = useId().replace(/:/g, "");
  const pct = obiettivo > 0 ? (valore / obiettivo) * 100 : 0;
  const limitata = Math.max(0, Math.min(100, pct));

  const raggio = dimensione / 2 - 16;
  const circonferenza = 2 * Math.PI * raggio;
  const arco = 0.75; // tre quarti di giro: lascia spazio all'etichetta
  const lunghezza = circonferenza * arco;

  const colore =
    pct >= 100
      ? palette.positivo
      : soglia && obiettivo > 0 && valore < soglia
        ? palette.negativo
        : palette.serie[0];

  return (
    <div className="flex flex-col items-center">
      <div style={{ width: dimensione, height: dimensione * 0.82 }} className="relative">
        <svg width={dimensione} height={dimensione} className="-rotate-[225deg]">
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={colore} stopOpacity={imp.gradienti ? 0.55 : 1} />
              <stop offset="100%" stopColor={colore} stopOpacity={1} />
            </linearGradient>
            {imp.bagliore && (
              <filter id={`b${id}`}>
                <feGaussianBlur stdDeviation="3" result="sfocato" />
                <feMerge>
                  <feMergeNode in="sfocato" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            )}
          </defs>

          <circle
            cx={dimensione / 2}
            cy={dimensione / 2}
            r={raggio}
            fill="none"
            stroke="currentColor"
            className="text-bg-page"
            strokeWidth={14}
            strokeDasharray={`${lunghezza} ${circonferenza}`}
            strokeLinecap="round"
          />

          {soglia != null && obiettivo > 0 && (
            <circle
              cx={dimensione / 2}
              cy={dimensione / 2}
              r={raggio}
              fill="none"
              stroke={palette.soglia}
              strokeWidth={14}
              strokeOpacity={0.18}
              strokeDasharray={`${lunghezza * Math.min(1, soglia / obiettivo)} ${circonferenza}`}
              strokeLinecap="round"
            />
          )}

          <motion.circle
            cx={dimensione / 2}
            cy={dimensione / 2}
            r={raggio}
            fill="none"
            stroke={`url(#g${id})`}
            strokeWidth={14}
            strokeLinecap="round"
            filter={imp.bagliore ? `url(#b${id})` : undefined}
            initial={durata ? { strokeDasharray: `0 ${circonferenza}` } : false}
            animate={{ strokeDasharray: `${(lunghezza * limitata) / 100} ${circonferenza}` }}
            transition={{ duration: durata / 1000, ease: "easeOut" }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
          <div className="font-tenorite font-bold text-2xl leading-none">{pct.toFixed(0)}%</div>
          <div className="text-[11px] text-text-muted mt-1">
            {valoreFmt(valore, unita, true)}
          </div>
          <div className="text-[10px] text-text-muted">
            su {valoreFmt(obiettivo, unita, true)}
          </div>
        </div>
      </div>
      <div className="text-xs font-medium text-center mt-1">{etichetta}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TREEMAP — composizione
// ─────────────────────────────────────────────────────────────────────────────

interface NodoTreemap {
  name: string;
  size: number;
  indice: number;
}

interface PropsTreemap {
  colore: (i: number) => string;
  fmt: (n: number) => string;
}

/**
 * Recharts inietta nel `content` le proprietà del nodo (x, y, width, …) che
 * non compaiono nella firma: si dichiarano quelle che servono e si legge il
 * resto da un indice generico.
 */
function ContenutoTreemap(props: PropsTreemap & Record<string, unknown>) {
  const p = props as unknown as {
    x: number; y: number; width: number; height: number;
    name?: string; size?: number; indice?: number;
    colore?: (i: number) => string; fmt?: (n: number) => string;
  };
  const { x, y, width, height, name, size, indice = 0 } = p;
  if (width < 2 || height < 2) return null;
  const mostraTesto = width > 62 && height > 30;
  const colore = p.colore ? p.colore(indice) : "#00a1be";

  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        fill={colore}
        fillOpacity={0.88}
        stroke="#fff"
        strokeWidth={2}
        rx={3}
      />
      {mostraTesto && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={11} fontWeight={600}>
            {String(name).length > Math.floor(width / 7)
              ? `${String(name).slice(0, Math.floor(width / 7))}…`
              : name}
          </text>
          <text x={x + 8} y={y + 33} fill="#fff" fontSize={11} fillOpacity={0.85}>
            {p.fmt ? p.fmt(size ?? 0) : size}
          </text>
        </>
      )}
    </g>
  );
}

export function Composizione({
  dati,
  unita = "euro",
  altezza = 300,
  onClick,
}: {
  dati: { etichetta: string; valore: number }[];
  unita?: UnitaMisura;
  altezza?: number;
  onClick?: (etichetta: string) => void;
}) {
  const { colore, imp, durata } = useImpostazioni();
  const fmt = (n: number) => valoreFmt(n, unita, imp.numeriCompatti);

  const nodi = useMemo<NodoTreemap[]>(
    () =>
      [...dati]
        .filter((d) => d.valore > 0)
        .sort((a, b) => b.valore - a.valore)
        .slice(0, imp.topN)
        .map((d, i) => ({ name: d.etichetta, size: d.valore, indice: i })),
    [dati, imp.topN]
  );

  if (nodi.length === 0) return <Vuoto altezza={altezza} />;

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <Treemap
        data={nodi}
        dataKey="size"
        nameKey="name"
        animationDuration={durata}
        // Il cast serve perché la firma di `content` in Recharts non prevede
        // props personalizzate, che però vengono inoltrate al componente.
        content={(<ContenutoTreemap colore={colore} fmt={fmt} />) as never}
        onClick={(d: unknown) => {
          const n = d as { name?: string };
          if (onClick && n?.name) onClick(n.name);
        }}
      >
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as NodoTreemap;
            const totale = nodi.reduce((s, n) => s + n.size, 0);
            return (
              <Riquadro
                titolo={d.name}
                voci={[
                  { etichetta: "Valore", valore: valoreFmt(d.size, unita, false) },
                  {
                    etichetta: "Quota",
                    valore: `${totale ? ((d.size / totale) * 100).toFixed(1) : 0}%`,
                  },
                ]}
              />
            );
          }}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CALENDARIO — "il ritmo di lavoro, giorno per giorno"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Griglia annuale in stile contributi: 53 settimane × 7 giorni.
 * Sul carico del back office mostra in un colpo solo le settimane di punta,
 * le chiusure e i giorni morti — cose che una serie mensile nasconde.
 */
export function CalendarioAttivita({
  valori,
  anno,
  unita = "numero",
  onClick,
}: {
  /** Mappa data ISO → valore. */
  valori: Record<string, number>;
  anno: number;
  unita?: UnitaMisura;
  onClick?: (data: string) => void;
}) {
  const { palette } = useImpostazioni();

  const { settimane, massimo, totale, giorniAttivi } = useMemo(() => {
    const inizio = new Date(Date.UTC(anno, 0, 1));
    const fine = new Date(Date.UTC(anno, 11, 31));
    // Si parte dal lunedì della settimana che contiene il 1° gennaio.
    const primo = new Date(inizio);
    primo.setUTCDate(primo.getUTCDate() - ((primo.getUTCDay() + 6) % 7));

    const sett: { data: string; valore: number; nelAnno: boolean }[][] = [];
    const cursore = new Date(primo);
    let max = 0;
    let tot = 0;
    let attivi = 0;

    while (cursore <= fine) {
      const colonna: { data: string; valore: number; nelAnno: boolean }[] = [];
      for (let g = 0; g < 7; g++) {
        const iso = cursore.toISOString().slice(0, 10);
        const v = valori[iso] ?? 0;
        const nelAnno = cursore.getUTCFullYear() === anno;
        if (nelAnno) {
          max = Math.max(max, v);
          tot += v;
          if (v > 0) attivi += 1;
        }
        colonna.push({ data: iso, valore: v, nelAnno });
        cursore.setUTCDate(cursore.getUTCDate() + 1);
      }
      sett.push(colonna);
    }
    return { settimane: sett, massimo: max, totale: tot, giorniAttivi: attivi };
  }, [valori, anno]);

  if (massimo === 0) return <Vuoto altezza={140} testo="Nessuna attività nel periodo" />;

  const base = palette.serie[0];
  const intensita = (v: number) => (massimo > 0 ? Math.min(1, v / massimo) : 0);

  const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const GIORNI = ["lun", "", "mer", "", "ven", "", ""];

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2 text-xs text-text-muted">
        <span>
          <strong className="text-text">{valoreFmt(totale, unita, true)}</strong> in{" "}
          {giorniAttivi} giorni attivi
        </span>
        <span>
          picco <strong className="text-text">{valoreFmt(massimo, unita, true)}</strong>
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex gap-[3px]">
          {/* Etichette dei giorni */}
          <div className="flex flex-col gap-[3px] pr-1">
            {GIORNI.map((g, i) => (
              <div key={i} className="h-[11px] text-[9px] text-text-muted leading-[11px] w-6">
                {g}
              </div>
            ))}
          </div>

          {settimane.map((colonna, i) => {
            const primoDelMese = colonna.find(
              (d) => d.nelAnno && Number(d.data.slice(8, 10)) <= 7
            );
            return (
              <div key={i} className="flex flex-col gap-[3px]">
                <div className="h-3 text-[9px] text-text-muted leading-3 whitespace-nowrap">
                  {primoDelMese ? MESI[Number(primoDelMese.data.slice(5, 7)) - 1] : ""}
                </div>
                {colonna.map((d) => (
                  <div
                    key={d.data}
                    onClick={() => d.nelAnno && onClick?.(d.data)}
                    title={
                      d.nelAnno
                        ? `${d.data}: ${valoreFmt(d.valore, unita, false)}`
                        : undefined
                    }
                    className={`w-[11px] h-[11px] rounded-[2px] ${
                      onClick && d.nelAnno ? "cursor-pointer hover:ring-2 hover:ring-primary/40" : ""
                    }`}
                    style={{
                      background: !d.nelAnno
                        ? "transparent"
                        : d.valore === 0
                          ? "rgba(148,163,184,0.16)"
                          : base,
                      opacity: !d.nelAnno ? 0.25 : d.valore === 0 ? 1 : 0.25 + intensita(d.valore) * 0.75,
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-text-muted">
        <span>meno</span>
        {[0, 0.25, 0.5, 0.75, 1].map((o) => (
          <span
            key={o}
            className="w-[11px] h-[11px] rounded-[2px]"
            style={{
              background: o === 0 ? "rgba(148,163,184,0.16)" : base,
              opacity: o === 0 ? 1 : 0.25 + o * 0.75,
            }}
          />
        ))}
        <span>più</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. AREE IMPILATE — "come si distribuisce nel tempo"
// ─────────────────────────────────────────────────────────────────────────────

export function AreeImpilate({
  periodi,
  serie,
  unita = "numero",
  altezza = 300,
  normalizzato = false,
  onClick,
}: {
  periodi: string[];
  serie: { nome: string; valori: Record<string, number> }[];
  unita?: UnitaMisura;
  altezza?: number;
  /** true = ogni periodo vale 100%: mostra la composizione, non il volume. */
  normalizzato?: boolean;
  onClick?: (nome: string) => void;
}) {
  const { colore, imp, durata, palette } = useImpostazioni();
  const id = useId().replace(/:/g, "");

  const dati = useMemo(() => {
    return periodi.map((p) => {
      const riga: Record<string, string | number> = { periodo: p };
      const totale = serie.reduce((s, x) => s + (x.valori[p] ?? 0), 0);
      for (const x of serie) {
        const v = x.valori[p] ?? 0;
        riga[x.nome] = normalizzato && totale > 0 ? (v / totale) * 100 : v;
      }
      return riga;
    });
  }, [periodi, serie, normalizzato]);

  if (serie.length === 0 || periodi.length === 0) return <Vuoto altezza={altezza} />;
  const unitaEffettiva: UnitaMisura = normalizzato ? "percentuale" : unita;

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <AreaChart data={dati} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <defs>
          {serie.map((s, i) => (
            <linearGradient key={s.nome} id={`a${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colore(i)} stopOpacity={imp.gradienti ? 0.9 : 0.75} />
              <stop offset="100%" stopColor={colore(i)} stopOpacity={imp.gradienti ? 0.45 : 0.75} />
            </linearGradient>
          ))}
        </defs>
        {imp.mostraGriglia && (
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        )}
        <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: "#64748b" }} minTickGap={16} />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickFormatter={(v) => valoreFmt(Number(v), unitaEffettiva, true)}
          domain={normalizzato ? [0, 100] : undefined}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const voci = [...payload]
              .sort((a, b) => Number(b.value) - Number(a.value))
              .map((p) => ({
                etichetta: String(p.dataKey),
                valore: valoreFmt(Number(p.value), unitaEffettiva, false),
                colore: p.color,
              }));
            return <Riquadro titolo={String(label)} voci={voci} />;
          }}
        />
        {imp.mostraLegenda && (
          <Legend
            wrapperStyle={{ fontSize: 11, cursor: onClick ? "pointer" : undefined }}
            onClick={(e) => {
              const v = e as { value?: string };
              if (onClick && v.value) onClick(v.value);
            }}
          />
        )}
        {serie.map((s, i) => (
          <Area
            key={s.nome}
            type="monotone"
            dataKey={s.nome}
            stackId="1"
            stroke={colore(i)}
            strokeWidth={1}
            fill={`url(#a${id}-${i})`}
            animationDuration={durata}
          />
        ))}
        {!normalizzato && palette.neutro && null}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ANELLI — confronto compatto di percentuali
// ─────────────────────────────────────────────────────────────────────────────

export function Anelli({
  voci,
  onClick,
}: {
  voci: { etichetta: string; percentuale: number; nota?: string }[];
  onClick?: (etichetta: string) => void;
}) {
  const { colore, durata } = useImpostazioni();
  const id = useId().replace(/:/g, "");
  if (voci.length === 0) return <Vuoto altezza={140} />;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {voci.map((v, i) => {
        const r = 26;
        const c = 2 * Math.PI * r;
        const p = Math.max(0, Math.min(100, v.percentuale));
        return (
          <button
            key={v.etichetta}
            onClick={() => onClick?.(v.etichetta)}
            className={`flex flex-col items-center p-2 rounded-lg ${
              onClick ? "hover:bg-bg-page transition-colors" : ""
            }`}
          >
            <div className="relative" style={{ width: 68, height: 68 }}>
              <svg width={68} height={68} className="-rotate-90">
                <circle
                  cx={34} cy={34} r={r} fill="none"
                  stroke="currentColor" className="text-bg-page" strokeWidth={7}
                />
                <motion.circle
                  cx={34} cy={34} r={r} fill="none"
                  stroke={colore(i)} strokeWidth={7} strokeLinecap="round"
                  initial={durata ? { strokeDasharray: `0 ${c}` } : false}
                  animate={{ strokeDasharray: `${(c * p) / 100} ${c}` }}
                  transition={{ duration: durata / 1000, ease: "easeOut", delay: i * 0.05 }}
                  key={`${id}-${i}`}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-tenorite font-bold text-sm">{p.toFixed(0)}%</span>
              </div>
            </div>
            <div className="text-[11px] font-medium text-center mt-1 truncate w-full" title={v.etichetta}>
              {v.etichetta}
            </div>
            {v.nota && <div className="text-[10px] text-text-muted">{v.nota}</div>}
          </button>
        );
      })}
    </div>
  );
}
