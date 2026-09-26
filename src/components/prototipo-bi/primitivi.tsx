"use client";

/**
 *
 * Primitivi del cruscotto. Il principio: un grafico è una SPEC, mai codice.
 * I componenti qui sotto ricevono una `SpecQuery`, la mandano all'API e la
 * disegnano. Se domani cambia la definizione di "ordinato", cambia in un
 * punto solo e si aggiorna tutto.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RisultatoQuery, SpecQuery, UnitaMisura } from "@/lib/prototipo-bi/tipi";
import {
  propsAsseCategorie,
  propsAsseValori,
  propsLegenda,
  useImpostazioni,
} from "./impostazioni";

// ─────────────────────────────────────────────────────────────────────────────
// Formattazione
// ─────────────────────────────────────────────────────────────────────────────

export function euro(n: number, compatto = true): string {
  if (compatto && Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} M€`;
  if (compatto && Math.abs(n) >= 1000)
    return `${(n / 1000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} k€`;
  return `${n.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

export function numero(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 0 });
}

export function percentuale(n: number, decimali = 1): string {
  return `${n.toLocaleString("it-IT", { maximumFractionDigits: decimali })}%`;
}

export function giorni(n: number): string {
  const v = n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
  return `${v} ${Math.abs(n) === 1 ? "giorno" : "giorni"}`;
}

/** Formattatore universale: ogni metrica porta con sé la propria unità. */
export function valoreFmt(n: number, unita: UnitaMisura, compatto = true): string {
  switch (unita) {
    case "euro":
      return euro(n, compatto);
    case "percentuale":
      return percentuale(n);
    case "giorni":
      return compatto ? `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })} gg` : giorni(n);
    default:
      return numero(n);
  }
}

/** Ripiego fuori dal contesto: la stessa sequenza della palette SICS. */
export const PALETTE = [
  "#00A1BE",
  "#C82381",
  "#95C11F",
  "#EE7326",
  "#E73331",
  "#747373",
  "#F4C948",
  "#004867",
];

/** Stile delle etichette stampate sui valori, quando sono accese. */
const STILE_ETICHETTA = { fontSize: 10, fill: "#475569" };

// ─────────────────────────────────────────────────────────────────────────────
// Recupero dati
// ─────────────────────────────────────────────────────────────────────────────

export interface EsitoQuery {
  risultati: Record<string, RisultatoQuery | undefined>;
  errori: Record<string, string>;
  caricamento: boolean;
  dataMassima: string | null;
  ricarica: () => void;
}

/**
 * Cache dei risultati per il browser.
 *
 * Vive a livello di modulo, quindi sopravvive al cambio di schermata: tornare
 * su una vista già aperta, o rimettere un filtro appena tolto, ridisegna
 * subito invece di rifare il giro fino al server. È la differenza che si
 * sente rispetto a Power BI, che tiene il modello in memoria.
 *
 * I dati restano quelli di un caricamento giornaliero: dieci minuti di
 * validità non rischiano di mostrare numeri superati.
 */
const cacheClient = new Map<
  string,
  { risultati: Record<string, RisultatoQuery | undefined>; dataMassima: string | null; scadenza: number }
>();

const DURATA_CACHE_MS = 10 * 60 * 1000;

// Chi usa `useQueryBi` si iscrive qui: svuotare la cache deve anche far
// ripartire le richieste dei grafici gia' montati. Prima si svuotava e basta,
// e un grafico rifaceva la richiesta solo se cambiava la sua spec — cioe' quasi
// mai: il tasto di aggiornamento lasciava a video i numeri vecchi.
let generazioneCache = 0;
const iscritti = new Set<(g: number) => void>();

/** Svuota la cache del browser e fa rileggere tutti i grafici a video. */
export function svuotaCacheQuery() {
  cacheClient.clear();
  generazioneCache += 1;
  for (const f of iscritti) f(generazioneCache);
}

/** Esegue più spec in una sola chiamata. */
export function useQueryBi(specs: Record<string, SpecQuery | null>): EsitoQuery {
  const chiave = useMemo(() => JSON.stringify(specs), [specs]);

  // Se il risultato è già in cache si parte da quello: niente scheletri di
  // caricamento per dati che il browser ha già.
  const daCache = () => {
    const v = cacheClient.get(chiave);
    if (!v || v.scadenza < Date.now()) return null;
    return v;
  };

  const iniziale = daCache();
  const [risultati, setRisultati] = useState<Record<string, RisultatoQuery | undefined>>(
    iniziale?.risultati ?? {}
  );
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [caricamento, setCaricamento] = useState(!iniziale);
  const [dataMassima, setDataMassima] = useState<string | null>(iniziale?.dataMassima ?? null);
  const [nonce, setNonce] = useState(0);
  const [generazione, setGenerazione] = useState(generazioneCache);

  useEffect(() => {
    iscritti.add(setGenerazione);
    return () => {
      iscritti.delete(setGenerazione);
    };
  }, []);

  useEffect(() => {
    let annullato = false;

    const inCache = cacheClient.get(chiave);
    const valida = inCache && inCache.scadenza >= Date.now();
    if (valida && nonce === 0) {
      setRisultati(inCache.risultati);
      setDataMassima(inCache.dataMassima);
      setErrori({});
      setCaricamento(false);
      return;
    }

    const attive = Object.entries(JSON.parse(chiave) as Record<string, SpecQuery | null>)
      .filter(([, s]) => s !== null)
      .map(([id, spec]) => ({ id, spec: spec as SpecQuery }));

    if (attive.length === 0) {
      setRisultati({});
      setCaricamento(false);
      return;
    }

    setCaricamento(true);
    fetch("/api/bi/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specs: attive }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Errore query");
        return j as {
          risultati: { id: string; risultato?: RisultatoQuery; errore?: string }[];
          dataMassima: string | null;
        };
      })
      .then((j) => {
        if (annullato) return;
        const ok: Record<string, RisultatoQuery | undefined> = {};
        const ko: Record<string, string> = {};
        for (const r of j.risultati) {
          if (r.risultato) ok[r.id] = r.risultato;
          if (r.errore) ko[r.id] = r.errore;
        }
        setRisultati(ok);
        setErrori(ko);
        setDataMassima(j.dataMassima);
        cacheClient.set(chiave, {
          risultati: ok,
          dataMassima: j.dataMassima,
          scadenza: Date.now() + DURATA_CACHE_MS,
        });
      })
      .catch((e) => {
        if (!annullato) setErrori({ _generale: e instanceof Error ? e.message : "Errore" });
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });

    return () => {
      annullato = true;
    };
  }, [chiave, nonce, generazione]);

  return {
    risultati,
    errori,
    caricamento,
    dataMassima,
    ricarica: () => {
      cacheClient.delete(chiave);
      setNonce((n) => n + 1);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Numero che sale — l'unico effetto "scenografico" che serve davvero:
// l'occhio segue la cifra e capisce che è viva.
// ─────────────────────────────────────────────────────────────────────────────

export function NumeroAnimato({
  valore,
  formatta = (n: number) => euro(n),
  durata = 900,
}: {
  valore: number;
  formatta?: (n: number) => string;
  durata?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inVista = useInView(ref, { once: true, margin: "-40px" });
  // Il numero deve essere vero anche prima che la card entri nel viewport:
  // mostrare 0 come placeholder rendeva le KPI sotto la piega apparentemente
  // non compilate e comunicava un dato falso anche alle tecnologie assistive.
  const [mostrato, setMostrato] = useState(valore);
  const precedente = useRef(valore);

  useEffect(() => {
    if (!inVista) {
      precedente.current = valore;
      setMostrato(valore);
      return;
    }
    let raf = 0;
    const inizio = performance.now();
    const partenza = precedente.current;
    precedente.current = valore;
    const tick = (t: number) => {
      const p = Math.min(1, (t - inizio) / durata);
      // easeOutCubic
      const e = 1 - Math.pow(1 - p, 3);
      setMostrato(partenza + (valore - partenza) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inVista, valore, durata]);

  return <span ref={ref}>{formatta(mostrato)}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contenitori
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spiegazione di un grafico, sotto una "i".
 *
 * Sta in un `<details>` invece che in un tooltip CSS per due motivi: resta
 * accessibile da tastiera e funziona al tocco, dove l'hover non esiste. Il
 * testo compare sotto l'intestazione senza spostare il grafico.
 */
function BottoneInfo({ testo }: { testo: string }) {
  const [aperto, setAperto] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        onMouseEnter={() => setAperto(true)}
        onMouseLeave={() => setAperto(false)}
        aria-label="Come si legge questo grafico"
        aria-expanded={aperto}
        className={`w-4 h-4 rounded-full border text-[10px] leading-none flex items-center justify-center transition-colors ${
          aperto
            ? "border-primary bg-primary text-white"
            : "border-border text-text-muted hover:border-primary hover:text-primary"
        }`}
      >
        i
      </button>
      {aperto && (
        <span
          role="tooltip"
          className="absolute left-0 top-6 z-30 w-72 rounded-lg border border-border bg-bg shadow-lg p-3 text-xs font-normal normal-case tracking-normal text-text"
        >
          {testo}
        </span>
      )}
    </span>
  );
}

export function Scheda({
  titolo,
  sottotitolo,
  info,
  azione,
  children,
  className = "",
  scuro = false,
}: {
  titolo?: string;
  sottotitolo?: string;
  /** Come si legge il grafico: compare sotto la "i" accanto al titolo. */
  info?: string;
  azione?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  scuro?: boolean;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`rounded-xl border ${
        scuro ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-bg border-border"
      } p-4 ${className}`}
    >
      {(titolo || azione) && (
        <header className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {titolo && (
              <h3
                className={`font-tenorite text-sm font-semibold tracking-wide uppercase flex items-center gap-2 ${
                  scuro ? "text-slate-300" : "text-text-muted"
                }`}
              >
                {titolo}
                {info && <BottoneInfo testo={info} />}
              </h3>
            )}
            {sottotitolo && (
              <p className={`text-xs mt-0.5 ${scuro ? "text-slate-500" : "text-text-muted"}`}>
                {sottotitolo}
              </p>
            )}
          </div>
          {azione}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function KpiEroe({
  etichetta,
  valore,
  unita = "euro",
  confronto,
  nota,
  scuro = false,
}: {
  etichetta: string;
  valore: number | null | undefined;
  unita?: UnitaMisura;
  confronto?: { valore: number; etichetta: string; buonoSeAlto?: boolean } | null;
  nota?: string;
  scuro?: boolean;
}) {
  const disponibile = valore !== null && valore !== undefined;
  const valoreNumerico = valore ?? 0;
  const fmt = (n: number) => valoreFmt(n, unita);
  const delta = disponibile && confronto ? valoreNumerico - confronto.valore : null;
  const deltaPct =
    confronto && confronto.valore !== 0 ? (delta! / Math.abs(confronto.valore)) * 100 : null;
  const buonoSeAlto = confronto?.buonoSeAlto ?? true;
  const positivo = delta !== null && (buonoSeAlto ? delta >= 0 : delta <= 0);

  return (
    <div>
      <div
        className={`text-xs uppercase tracking-wide font-tenorite ${
          scuro ? "text-slate-400" : "text-text-muted"
        }`}
      >
        {etichetta}
      </div>
      <div
        className={`font-tenorite font-bold leading-none mt-1 text-3xl lg:text-4xl ${
          scuro ? "text-white" : "text-text"
        }`}
      >
        {disponibile ? (
          <NumeroAnimato valore={valoreNumerico} formatta={fmt} />
        ) : (
          <span className="inline-block animate-pulse text-slate-500" aria-label="Dato in caricamento">—</span>
        )}
      </div>
      {confronto && deltaPct !== null && (
        <div
          className={`text-xs mt-1.5 font-medium ${
            positivo ? "text-success" : "text-danger"
          }`}
        >
          {delta! >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}% ({delta! >= 0 ? "+" : ""}
          {fmt(delta!)}) {confronto.etichetta}
        </div>
      )}
      {nota && (
        <div className={`text-[11px] mt-1 ${scuro ? "text-slate-500" : "text-text-muted"}`}>
          {nota}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grafici
// ─────────────────────────────────────────────────────────────────────────────

const ASSE = { fontSize: 11, fill: "#64748b" };

function tooltipFormatter(unita: UnitaMisura) {
  return (v: number | string) => valoreFmt(Number(v), unita, false);
}

/** Tooltip che mostra anche la quota sul totale: il confronto che serve sempre. */
function TooltipQuota({
  active,
  payload,
  totale,
  unita,
}: {
  active?: boolean;
  payload?: { payload: { nome?: string; nomeCompleto?: string; valore: number } }[];
  totale: number;
  unita: UnitaMisura;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const v = d.valore;
  const quota = totale ? (v / totale) * 100 : 0;
  return (
    <div className="rounded-lg border border-border bg-bg shadow-lg px-3 py-2 text-xs">
      <div className="font-tenorite font-semibold mb-1 text-text">
        {d.nomeCompleto ?? d.nome}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-muted">Valore</span>
        <span className="tabular-nums font-medium">{valoreFmt(v, unita, false)}</span>
      </div>
      {unita !== "percentuale" && unita !== "giorni" && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Quota sul totale</span>
          <span className="tabular-nums font-medium">{quota.toFixed(1)}%</span>
        </div>
      )}
      <div className="mt-1.5 pt-1.5 border-t border-border text-[10px] text-text-muted">
        Clicca per filtrare tutto il cruscotto
      </div>
    </div>
  );
}

export function GraficoBarre({
  risultato,
  orizzontale = false,
  altezza = 260,
  colore,
  massimo,
  onClick,
  selezionata,
}: {
  risultato?: RisultatoQuery;
  orizzontale?: boolean;
  altezza?: number;
  colore?: string;
  massimo?: number;
  onClick?: (etichetta: string) => void;
  selezionata?: string | null;
}) {
  const { imp, colore: coloreSerie, coloreFisso, aspetto, durata } = useImpostazioni();
  if (!risultato) return <Scheletro altezza={altezza} />;
  const limite = massimo ?? imp.topN;
  const dati = risultato.righe.slice(0, limite).map((r) => ({
    nome: r.etichetta.length > 26 ? `${r.etichetta.slice(0, 25)}…` : r.etichetta,
    nomeCompleto: r.etichetta,
    valore: r.valore,
  }));
  if (dati.length === 0) return <Vuoto altezza={altezza} />;
  const totale = risultato.righe.reduce((s, r) => s + r.valore, 0);
  const tinta = colore ?? coloreSerie(0);

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <BarChart data={dati} layout={orizzontale ? "vertical" : "horizontal"} margin={{ left: orizzontale ? 8 : 0, right: 12, top: 8, bottom: 0 }}>
        {imp.mostraGriglia && (
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={!orizzontale} />
        )}
        {orizzontale ? (
          <>
            <XAxis type="number" tick={ASSE} tickFormatter={(v) => valoreFmt(v, risultato.unita, imp.numeriCompatti)} {...propsAsseValori(aspetto)} />
            <YAxis type="category" dataKey="nome" tick={ASSE} width={140} {...propsAsseCategorie(aspetto)} />
          </>
        ) : (
          <>
            <XAxis dataKey="nome" tick={ASSE} interval={0} angle={-25} textAnchor="end" height={64} {...propsAsseCategorie(aspetto)} />
            <YAxis tick={ASSE} tickFormatter={(v) => valoreFmt(v, risultato.unita, imp.numeriCompatti)} {...propsAsseValori(aspetto)} />
          </>
        )}
        <Tooltip
          cursor={{ fill: "rgba(0,161,190,0.06)" }}
          content={(p) => {
            const props = p as { active?: boolean; payload?: { payload: { nome?: string; nomeCompleto?: string; valore: number } }[] };
            return (
              <TooltipQuota
                active={props.active}
                payload={props.payload}
                totale={totale}
                unita={risultato.unita}
              />
            );
          }}
        />
        <Bar
          dataKey="valore"
          radius={
            orizzontale
              ? [0, imp.arrotondamento, imp.arrotondamento, 0]
              : [imp.arrotondamento, imp.arrotondamento, 0, 0]
          }
          animationDuration={durata}
          cursor={onClick ? "pointer" : undefined}
          onClick={(d: unknown) => {
            const x = d as { nomeCompleto?: string };
            if (onClick && x.nomeCompleto) onClick(x.nomeCompleto);
          }}
        >
          {dati.map((d, i) => (
            <Cell
              key={i}
              // Una barra che e' una business unit (o una voce colorata nel
              // riquadro) porta il suo colore; le altre la tinta della serie.
              fill={coloreFisso(d.nomeCompleto) ?? tinta}
              fillOpacity={selezionata && selezionata !== d.nomeCompleto ? 0.28 : 1}
            />
          ))}
          {imp.mostraEtichette && (
            <LabelList
              dataKey="valore"
              position={orizzontale ? "right" : "top"}
              style={STILE_ETICHETTA}
              formatter={(v: unknown) => valoreFmt(Number(v), risultato.unita, true)}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GraficoLinee({
  serie,
  altezza = 280,
}: {
  serie: { nome: string; risultato?: RisultatoQuery; colore?: string; tratteggiata?: boolean }[];
  altezza?: number;
}) {
  const { imp, coloreNome, aspetto, legenda, durata } = useImpostazioni();
  const attive = serie.filter((s) => s.risultato);
  if (attive.length === 0) return <Scheletro altezza={altezza} />;
  // L'asse segue l'unita' della prima serie: prima era sempre in euro, e un
  // tasso di conversione compariva come "35 €".
  const unita = attive[0].risultato!.unita;

  // Unione delle etichette temporali di tutte le serie.
  const etichette = [
    ...new Set(attive.flatMap((s) => s.risultato!.righe.map((r) => r.etichetta))),
  ].sort();
  if (etichette.length === 0) return <Vuoto altezza={altezza} />;

  const dati = etichette.map((e) => {
    const riga: Record<string, string | number> = { periodo: e };
    for (const s of attive) {
      const trovata = s.risultato!.righe.find((r) => r.etichetta === e);
      if (trovata) riga[s.nome] = trovata.valore;
    }
    return riga;
  });

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <LineChart data={dati} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        {imp.mostraGriglia && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
        <XAxis dataKey="periodo" tick={ASSE} minTickGap={24} {...propsAsseCategorie(aspetto)} />
        <YAxis tick={ASSE} tickFormatter={(v) => valoreFmt(v, unita, imp.numeriCompatti)} {...propsAsseValori(aspetto)} />
        <Tooltip formatter={tooltipFormatter(unita)} />
        {legenda !== "nascosta" && <Legend {...propsLegenda(legenda)} />}
        {attive.map((s, i) => (
          <Line
            key={s.nome}
            type="monotone"
            dataKey={s.nome}
            stroke={s.colore ?? coloreNome(s.nome, i)}
            strokeWidth={2}
            strokeDasharray={s.tratteggiata ? "5 4" : undefined}
            dot={false}
            animationDuration={durata}
            connectNulls
          >
            {imp.mostraEtichette && (
              <LabelList
                dataKey={s.nome}
                position="top"
                style={STILE_ETICHETTA}
                formatter={(v: unknown) => valoreFmt(Number(v), unita, true)}
              />
            )}
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GraficoCombo({
  barre,
  linee,
  altezza = 300,
}: {
  barre: { nome: string; risultato?: RisultatoQuery; colore?: string };
  linee: { nome: string; risultato?: RisultatoQuery; colore?: string; tratteggiata?: boolean }[];
  altezza?: number;
}) {
  const { imp, coloreNome, aspetto, legenda, durata } = useImpostazioni();
  if (!barre.risultato) return <Scheletro altezza={altezza} />;
  const unita = barre.risultato.unita;
  const attive = linee.filter((l) => l.risultato);
  const etichette = [
    ...new Set([
      ...barre.risultato.righe.map((r) => r.etichetta),
      ...attive.flatMap((l) => l.risultato!.righe.map((r) => r.etichetta)),
    ]),
  ].sort();
  if (etichette.length === 0) return <Vuoto altezza={altezza} />;

  const dati = etichette.map((e) => {
    const riga: Record<string, string | number> = { periodo: e };
    const b = barre.risultato!.righe.find((r) => r.etichetta === e);
    if (b) riga[barre.nome] = b.valore;
    for (const l of attive) {
      const t = l.risultato!.righe.find((r) => r.etichetta === e);
      if (t) riga[l.nome] = t.valore;
    }
    return riga;
  });

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <ComposedChart data={dati} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        {imp.mostraGriglia && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
        <XAxis dataKey="periodo" tick={ASSE} minTickGap={20} {...propsAsseCategorie(aspetto)} />
        <YAxis tick={ASSE} tickFormatter={(v) => valoreFmt(v, unita, imp.numeriCompatti)} {...propsAsseValori(aspetto)} />
        <Tooltip formatter={tooltipFormatter(unita)} />
        {legenda !== "nascosta" && <Legend {...propsLegenda(legenda)} />}
        <Bar
          dataKey={barre.nome}
          fill={barre.colore ?? coloreNome(barre.nome, 0)}
          radius={[imp.arrotondamento, imp.arrotondamento, 0, 0]}
          animationDuration={durata}
        >
          {imp.mostraEtichette && (
            <LabelList
              dataKey={barre.nome}
              position="top"
              style={STILE_ETICHETTA}
              formatter={(v: unknown) => valoreFmt(Number(v), unita, true)}
            />
          )}
        </Bar>
        {attive.map((l, i) => (
          <Line
            key={l.nome}
            type="monotone"
            dataKey={l.nome}
            stroke={l.colore ?? coloreNome(l.nome, i + 1)}
            strokeWidth={2}
            strokeDasharray={l.tratteggiata ? "5 4" : undefined}
            dot={false}
            animationDuration={durata}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GraficoTorta({
  risultato,
  altezza = 260,
  massimo,
  onClick,
  selezionata,
}: {
  risultato?: RisultatoQuery;
  altezza?: number;
  massimo?: number;
  onClick?: (etichetta: string) => void;
  selezionata?: string | null;
}) {
  const { imp, coloreNome, aspetto, durata } = useImpostazioni();
  if (!risultato) return <Scheletro altezza={altezza} />;
  const righe = risultato.righe.slice(0, massimo ?? Math.min(8, imp.topN));
  if (righe.length === 0) return <Vuoto altezza={altezza} />;
  const totale = righe.reduce((s, r) => s + r.valore, 0);
  const dati = righe.map((r) => ({ nome: r.etichetta, valore: r.valore }));

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <PieChart>
        <Pie
          data={dati}
          dataKey="valore"
          nameKey="nome"
          innerRadius="52%"
          outerRadius="80%"
          paddingAngle={2}
          animationDuration={durata}
          cursor={onClick ? "pointer" : undefined}
          onClick={(d: unknown) => {
            const x = d as { nome?: string };
            if (onClick && x.nome) onClick(x.nome);
          }}
          label={({ name, value }) =>
            `${String(name).slice(0, 14)} ${totale ? Math.round((Number(value) / totale) * 100) : 0}%`
          }
          labelLine={false}
        >
          {dati.map((d, i) => (
            <Cell
              key={i}
              fill={coloreNome(d.nome, i)}
              fillOpacity={selezionata && selezionata !== d.nome ? 0.3 : 1}
            />
          ))}
        </Pie>
        {/* La torta mette gia' nome e quota sulle fette: la legenda compare
            solo se il riquadro la chiede esplicitamente. */}
        {aspetto?.legenda && aspetto.legenda !== "nascosta" && <Legend {...propsLegenda(aspetto.legenda)} />}
        <Tooltip
          content={(p) => {
            const props = p as { active?: boolean; payload?: { payload: { nome?: string; nomeCompleto?: string; valore: number } }[] };
            return (
              <TooltipQuota
                active={props.active}
                payload={props.payload}
                totale={totale}
                unita={risultato.unita}
              />
            );
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function Tabella({
  risultato,
  colonnaEtichetta = "Voce",
  massimo = 15,
}: {
  risultato?: RisultatoQuery;
  colonnaEtichetta?: string;
  massimo?: number;
}) {
  if (!risultato) return <Scheletro altezza={200} />;
  const righe = risultato.righe.slice(0, massimo);
  if (righe.length === 0) return <Vuoto altezza={140} />;
  const fmt = (n: number) => valoreFmt(n, risultato.unita, false);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-text-muted border-b border-border">
            <th className="py-2 pr-3 font-tenorite">{colonnaEtichetta}</th>
            <th className="py-2 text-right font-tenorite">Valore</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.etichetta} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-3 truncate max-w-[280px]" title={r.etichetta}>
                {r.etichetta}
              </td>
              <td className="py-1.5 text-right tabular-nums font-medium">{fmt(r.valore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stati
// ─────────────────────────────────────────────────────────────────────────────

export function Scheletro({ altezza = 200 }: { altezza?: number }) {
  return (
    <div
      className="w-full rounded-lg bg-bg-page animate-pulse"
      style={{ height: altezza }}
      aria-label="Caricamento"
    />
  );
}

export function Vuoto({ altezza = 200, testo = "Nessun dato nel periodo" }: { altezza?: number; testo?: string }) {
  return (
    <div
      className="w-full rounded-lg border border-dashed border-border flex items-center justify-center text-xs text-text-muted"
      style={{ height: altezza }}
    >
      {testo}
    </div>
  );
}

/** Badge di certificazione: la gerarchia di fiducia resa visibile. */
export function BadgeCertificata({ certificata = true }: { certificata?: boolean }) {
  return certificata ? (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">
      ✓ certificata
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">
      ⚠ esplorativa
    </span>
  );
}
