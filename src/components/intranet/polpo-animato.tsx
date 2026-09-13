"use client"

import { useState } from "react"

const CHIAVE_SESSIONE = "sics-hero-animato"

/**
 * Tracciati del marchio SICS, ricavati misurando il logo pixel per pixel e
 * verificati con un confronto a griglia contro la silhouette originale.
 * Griglia 650×650, tratto 28, terminali arrotondati.
 */
const TESTA = "M240 315 L240 148 A55 55 0 0 1 295 93 L343 93 A55 55 0 0 1 398 148 L398 315"
const RICCIOLO_SX = "M264 275 C282 272 297 288 297 310 L297 344 C297 364 288 374 268 374 L81 374"
const RICCIOLO_DX = "M374 275 C356 272 341 288 341 310 L341 344 C341 364 350 374 370 374 L557 374"

type Tracciato = { d: string; id?: string; begin: number; dur: number }

// L'ordine racconta la piegatura: prima la testa, poi i riccioli che escono
// nei tentacoli orizzontali, infine i quattro diagonali.
const TRACCIATI: Tracciato[] = [
  { id: "polpo-testa", d: TESTA, begin: 0.15, dur: 0.95 },
  { id: "polpo-ricciolo-sx", d: RICCIOLO_SX, begin: 0.75, dur: 0.95 },
  { id: "polpo-ricciolo-dx", d: RICCIOLO_DX, begin: 0.75, dur: 0.95 },
  { d: "M252 286 L115 149", begin: 1.35, dur: 0.5 },
  { d: "M386 286 L523 149", begin: 1.45, dur: 0.5 },
  { d: "M272 399 L113 558", begin: 1.55, dur: 0.5 },
  { d: "M366 399 L525 558", begin: 1.65, dur: 0.5 },
]

/**
 * Sezione del tubo, dal basso verso l'alto. Ogni strato è più stretto del
 * precedente e spostato verso la luce (in alto a sinistra): quello che resta
 * scoperto sotto diventa il lato in ombra. È così che una linea piatta legge
 * come un cilindro.
 */
const STRATI = [
  { w: 28, colore: "#1b5f77", dx: 2.5, dy: 3.5, opacita: 0.55 },
  { w: 28, colore: "#5aa6bf", dx: 0, dy: 0, opacita: 1, ancora: true },
  { w: 22, colore: "#cfe9f2", dx: -2, dy: -2.5, opacita: 1 },
  { w: 11, colore: "#ffffff", dx: -4.5, dy: -5.5, opacita: 1 },
]

// Punto luminoso che percorre i tre tracciati principali: è la testa della
// piegatrice che lascia il filo dietro di sé.
const TESTINE = [
  { path: "polpo-testa", r: 13, begin: 0.15, dur: 0.95 },
  { path: "polpo-ricciolo-sx", r: 11, begin: 0.75, dur: 0.95 },
  { path: "polpo-ricciolo-dx", r: 11, begin: 0.75, dur: 0.95 },
]

export function PolpoAnimato() {
  // L'animazione parte una volta per sessione: chi torna in home dal menù non
  // se la rivede. Il componente è caricato con ssr:false, quindi sessionStorage
  // è già disponibile al primo render.
  const [anima] = useState(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
    if (sessionStorage.getItem(CHIAVE_SESSIONE)) return false
    sessionStorage.setItem(CHIAVE_SESSIONE, "1")
    return true
  })

  return (
    <svg
      viewBox="0 0 650 650"
      className="h-full w-full drop-shadow-[0_12px_26px_rgba(0,40,58,0.35)]"
      aria-hidden
    >
      <defs>
        <filter id="polpo-bagliore" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="9" result="sfocato" />
          <feMerge>
            <feMergeNode in="sfocato" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {STRATI.map((s) => (
        <g
          key={s.colore + s.w}
          fill="none"
          stroke={s.colore}
          strokeWidth={s.w}
          strokeLinecap="round"
          opacity={s.opacita}
          transform={`translate(${s.dx} ${s.dy})`}
        >
          {TRACCIATI.map((t, i) => (
            <path
              key={t.id ?? i}
              // Le testine seguono i tracciati di questo solo strato, l'unico
              // senza scostamento: altrove il moto risulterebbe disallineato.
              id={s.ancora ? t.id : undefined}
              d={t.d}
              pathLength={anima ? 1 : undefined}
              strokeDasharray={anima ? 1 : undefined}
              strokeDashoffset={anima ? 1 : undefined}
            >
              {anima && (
                <animate
                  attributeName="stroke-dashoffset"
                  values="1;0"
                  keyTimes="0;1"
                  calcMode="spline"
                  keySplines="0.4 0 0.2 1"
                  begin={`${t.begin}s`}
                  dur={`${t.dur}s`}
                  fill="freeze"
                />
              )}
            </path>
          ))}
        </g>
      ))}

      {anima && (
        <g fill="#ffffff" filter="url(#polpo-bagliore)">
          {TESTINE.map((t) => (
            <circle key={t.path} r={t.r} opacity={0}>
              <animateMotion
                begin={`${t.begin}s`}
                dur={`${t.dur}s`}
                calcMode="spline"
                keyPoints="0;1"
                keyTimes="0;1"
                keySplines="0.4 0 0.2 1"
              >
                <mpath href={`#${t.path}`} />
              </animateMotion>
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.06;0.88;1"
                begin={`${t.begin}s`}
                dur={`${t.dur}s`}
              />
            </circle>
          ))}
        </g>
      )}
    </svg>
  )
}
