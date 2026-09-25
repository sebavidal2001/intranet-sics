"use client";

/**
 * Scelta del tipo di grafico con un'anteprima accanto al nome.
 *
 * «Pendenza», «Posizioni in classifica», «Flusso a stadi» dicono poco a chi
 * non li ha mai visti: un disegnino schematico basta a orientarsi. Il menu a
 * tendina del browser non puo' mostrare immagini, quindi e' un elenco proprio,
 * navigabile da tastiera.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { NOMI_GRAFICI, type TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";

const P = "var(--color-primary, #00a1be)";
const S = "#f59e0b";
const T = "#94a3b8";

/** Disegno schematico 40×26 di un tipo di grafico. */
export function AnteprimaGrafico({ tipo, className = "" }: { tipo: TipoGrafico; className?: string }) {
  const corpo = (() => {
    switch (tipo) {
      case "barre":
        return [8, 14, 11, 19, 16].map((h, i) => <rect key={i} x={3 + i * 7} y={24 - h} width="5" height={h} rx="1" fill={P} />);
      case "barreImpilate":
        return [
          [7, 5, 4],
          [9, 6, 5],
          [6, 4, 3],
          [10, 7, 5],
          [8, 6, 6],
        ].map((pila, i) => {
          let y = 24;
          return pila.map((h, j) => {
            y -= h;
            return <rect key={`${i}-${j}`} x={3 + i * 7} y={y} width="5" height={h} fill={[P, S, T][j]} />;
          });
        });
      case "linee":
        return <polyline points="2,20 10,14 18,16 26,8 38,5" fill="none" stroke={P} strokeWidth="2" strokeLinejoin="round" />;
      case "combo":
        return (
          <>
            {[10, 14, 9, 16].map((h, i) => <rect key={i} x={4 + i * 9} y={24 - h} width="6" height={h} rx="1" fill={T} />)}
            <polyline points="7,12 16,9 25,13 34,5" fill="none" stroke={S} strokeWidth="2" />
          </>
        );
      case "torta":
        return (
          <>
            <circle cx="20" cy="13" r="11" fill={T} />
            <path d="M20 13 L20 2 A11 11 0 0 1 30.5 16 Z" fill={P} />
            <path d="M20 13 L30.5 16 A11 11 0 0 1 14 22.5 Z" fill={S} />
          </>
        );
      case "anelli":
        return (
          <>
            <circle cx="20" cy="13" r="10" fill="none" stroke={T} strokeWidth="4" />
            <path d="M20 3 A10 10 0 1 1 10.5 16" fill="none" stroke={P} strokeWidth="4" />
          </>
        );
      case "areeImpilate":
        return (
          <>
            <path d="M2 24 L2 16 L12 13 L22 15 L32 9 L38 8 L38 24 Z" fill={T} />
            <path d="M2 24 L2 20 L12 18 L22 19 L32 14 L38 13 L38 24 Z" fill={P} />
          </>
        );
      case "pareto":
        return (
          <>
            {[18, 12, 8, 5, 3].map((h, i) => <rect key={i} x={3 + i * 7} y={24 - h} width="5" height={h} fill={P} />)}
            <polyline points="5,10 12,6 19,4 26,3 33,2" fill="none" stroke={S} strokeWidth="1.5" />
          </>
        );
      case "bullet":
        return (
          <>
            <rect x="2" y="8" width="36" height="10" fill="#e2e8f0" />
            <rect x="2" y="11" width="24" height="4" fill={P} />
            <rect x="30" y="6" width="2" height="14" fill={S} />
          </>
        );
      case "heatmap":
        return [0, 1, 2].flatMap((r) =>
          [0, 1, 2, 3, 4].map((c) => (
            <rect key={`${r}-${c}`} x={3 + c * 7} y={3 + r * 7} width="6" height="6" rx="1" fill={P} opacity={0.2 + (((r * 5 + c) * 37) % 80) / 100} />
          ))
        );
      case "matrice":
        return [0, 1, 2].flatMap((r) =>
          [0, 1, 2, 3].map((c) => <circle key={`${r}-${c}`} cx={7 + c * 9} cy={6 + r * 7} r={1 + ((r + c * 2) % 3)} fill={P} />)
        );
      case "quadranti":
        return (
          <>
            <line x1="20" y1="2" x2="20" y2="24" stroke="#cbd5e1" />
            <line x1="2" y1="13" x2="38" y2="13" stroke="#cbd5e1" />
            {[[8, 6, 3], [28, 8, 4], [12, 19, 2], [31, 19, 3]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={P} opacity="0.8" />)}
          </>
        );
      case "imbuto":
        return [36, 28, 20, 12].map((w, i) => <rect key={i} x={(40 - w) / 2} y={2 + i * 6} width={w} height="5" rx="1" fill={P} opacity={1 - i * 0.18} />);
      case "treemap":
        return (
          <>
            <rect x="2" y="2" width="20" height="22" fill={P} />
            <rect x="23" y="2" width="15" height="12" fill={S} />
            <rect x="23" y="15" width="8" height="9" fill={T} />
            <rect x="32" y="15" width="6" height="9" fill="#cbd5e1" />
          </>
        );
      case "sparkline":
        return <polyline points="2,16 7,12 12,14 17,9 22,11 27,6 32,10 38,7" fill="none" stroke={P} strokeWidth="1.5" />;
      case "pendenza":
        return (
          <>
            <line x1="8" y1="4" x2="8" y2="23" stroke="#cbd5e1" />
            <line x1="32" y1="4" x2="32" y2="23" stroke="#cbd5e1" />
            <line x1="8" y1="18" x2="32" y2="7" stroke={P} strokeWidth="2" />
            <line x1="8" y1="8" x2="32" y2="19" stroke={S} strokeWidth="2" />
          </>
        );
      case "distribuzione":
        return (
          <>
            <line x1="20" y1="2" x2="20" y2="24" stroke={T} />
            <rect x="12" y="8" width="16" height="10" fill="none" stroke={P} strokeWidth="2" />
            <line x1="12" y1="13" x2="28" y2="13" stroke={P} strokeWidth="2" />
          </>
        );
      case "posizioni":
        return (
          <>
            <polyline points="3,5 14,12 25,8 37,20" fill="none" stroke={P} strokeWidth="2" />
            <polyline points="3,20 14,6 25,18 37,5" fill="none" stroke={S} strokeWidth="2" />
          </>
        );
      case "flusso":
        return [34, 26, 17, 10].map((w, i) => <rect key={i} x="3" y={2 + i * 6} width={w} height="4" rx="1" fill={P} opacity={1 - i * 0.18} />);
      case "istogramma":
        return [4, 9, 16, 20, 13, 7, 3].map((h, i) => <rect key={i} x={3 + i * 5} y={24 - h} width="5" height={h} fill={P} stroke="#fff" strokeWidth="0.5" />);
      case "kpi":
        return (
          <text x="20" y="18" textAnchor="middle" fontSize="13" fontWeight="700" fill={P}>
            42
          </text>
        );
      case "tabella":
        return [0, 1, 2, 3].map((r) => (
          <g key={r}>
            <rect x="3" y={3 + r * 5.5} width="22" height="3" rx="1" fill={r === 0 ? P : T} />
            <rect x="28" y={3 + r * 5.5} width="9" height="3" rx="1" fill={r === 0 ? P : T} />
          </g>
        ));
    }
  })();
  return (
    <svg viewBox="0 0 40 26" width="40" height="26" aria-hidden className={`shrink-0 rounded border border-border bg-bg ${className}`}>
      {corpo}
    </svg>
  );
}

export function SceltaGrafico({
  valore,
  opzioni,
  onChange,
  etichetta,
  compatto = false,
  title,
}: {
  valore: TipoGrafico;
  opzioni: TipoGrafico[];
  onChange: (tipo: TipoGrafico) => void;
  etichetta: string;
  /** Per i riquadri della dashboard: bottone piu' basso. */
  compatto?: boolean;
  title?: string;
}) {
  const [aperto, setAperto] = useState(false);
  const [attivo, setAttivo] = useState(0);
  const contenitore = useRef<HTMLDivElement>(null);
  const lista = opzioni.includes(valore) ? opzioni : [valore, ...opzioni];

  useEffect(() => {
    if (!aperto) return;
    setAttivo(Math.max(0, lista.indexOf(valore)));
    const fuori = (e: MouseEvent) => {
      if (contenitore.current && !contenitore.current.contains(e.target as Node)) setAperto(false);
    };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
  }, [aperto]); // eslint-disable-line react-hooks/exhaustive-deps

  function scegli(tipo: TipoGrafico) {
    onChange(tipo);
    setAperto(false);
  }

  return (
    <div ref={contenitore} className="relative" title={title}>
      <button
        type="button"
        aria-label={etichetta}
        aria-haspopup="listbox"
        aria-expanded={aperto}
        onClick={() => setAperto((v) => !v)}
        onKeyDown={(e) => {
          if (!aperto && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setAperto(true);
          } else if (aperto) {
            if (e.key === "Escape") setAperto(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAttivo((i) => Math.min(lista.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAttivo((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              scegli(lista[attivo]);
            }
          }
        }}
        className={`flex w-full items-center gap-2 rounded-lg border border-border bg-bg-page text-left text-text focus:outline-none focus:ring-2 focus:ring-primary ${
          compatto ? "h-8 px-1.5 text-xs" : "min-h-10 px-2 text-sm"
        }`}
      >
        <AnteprimaGrafico tipo={valore} className={compatto ? "scale-75 -mx-1" : ""} />
        <span className="flex-1 truncate">{NOMI_GRAFICI[valore]}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      </button>

      {aperto && (
        <ul
          role="listbox"
          aria-label={etichetta}
          className="absolute right-0 z-30 mt-1 max-h-80 w-60 overflow-y-auto rounded-xl border border-border bg-bg p-1 shadow-lg"
        >
          {lista.map((tipo, i) => (
            <li
              key={tipo}
              role="option"
              aria-selected={tipo === valore}
              onMouseEnter={() => setAttivo(i)}
              onClick={() => scegli(tipo)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                i === attivo ? "bg-bg-page" : ""
              }`}
            >
              <AnteprimaGrafico tipo={tipo} />
              <span className="flex-1">{NOMI_GRAFICI[tipo]}</span>
              {tipo === valore && <Check className="h-4 w-4 text-primary" aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
