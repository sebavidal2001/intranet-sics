"use client"

import { useEffect, useState } from "react"

export type MascotStato = "idle" | "loading" | "success" | "hidden"

interface MascotProps {
  stato: MascotStato
  size?: number
  className?: string
  successDuration?: number
}

const KEYFRAMES = `
  @keyframes m-glass-sweep {
    0%   { transform: rotate(-26deg); }
    50%  { transform: rotate(20deg);  }
    100% { transform: rotate(-26deg); }
  }
  @keyframes m-arm-r-sweep {
    0%   { transform: rotate(-18deg); }
    50%  { transform: rotate(14deg);  }
    100% { transform: rotate(-18deg); }
  }
  @keyframes m-bounce-ok {
    0%   { transform: translateY(0px);   }
    28%  { transform: translateY(-12px); }
    50%  { transform: translateY(-6px);  }
    68%  { transform: translateY(-14px); }
    88%  { transform: translateY(-2px);  }
    100% { transform: translateY(0px);   }
  }
  @keyframes m-shadow-search {
    0%,100% { transform: scaleX(1);    opacity: 0.11; }
    50%     { transform: scaleX(0.88); opacity: 0.07; }
  }
  @keyframes m-shadow-ok {
    0%   { transform: scaleX(1);    opacity: 0.11; }
    28%  { transform: scaleX(0.52); opacity: 0.03; }
    68%  { transform: scaleX(0.48); opacity: 0.02; }
    100% { transform: scaleX(1);    opacity: 0.11; }
  }
`

export function Mascot({
  stato,
  size = 58,
  className = "",
  successDuration = 2200,
}: MascotProps) {
  const [displayed, setDisplayed] = useState<MascotStato>(stato)
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    if (stato === "success") {
      setDisplayed("success")
      const t = setTimeout(() => setDisplayed("idle"), successDuration)
      return () => clearTimeout(t)
    }
    setDisplayed(stato)
  }, [stato, successDuration])

  useEffect(() => {
    if (displayed === "hidden" || displayed === "loading") return
    let tid: ReturnType<typeof setTimeout>
    const schedule = () => {
      tid = setTimeout(() => {
        setBlinking(true)
        setTimeout(() => setBlinking(false), 130)
        schedule()
      }, 4000 + Math.random() * 3000)
    }
    schedule()
    return () => clearTimeout(tid)
  }, [displayed])

  if (displayed === "hidden") return null

  const d = displayed
  const isSuccess = d === "success"
  const isLoading = d === "loading"

  const bodyAnim = isSuccess
    ? `m-bounce-ok ${Math.round(successDuration * 0.6)}ms cubic-bezier(.34,1.56,.64,1) forwards`
    : "none"

  const shadowAnim = isLoading
    ? "m-shadow-search 1.4s ease-in-out infinite"
    : isSuccess
    ? `m-shadow-ok ${Math.round(successDuration * 0.6)}ms ease-in-out forwards`
    : "none"

  const eyeBlinkStyle: React.CSSProperties = blinking
    ? { transform: "scaleY(0.06)", transition: "transform 0.07s" }
    : { transform: "scaleY(1)",   transition: "transform 0.12s" }

  const OUTLINE = "#1a1a1a"

  // Silhouette unica testa+torace: un solo path scuro, nessun bordo doppio alla giunzione.
  // Testa: x=18 y=-4 w=84 h=76 → outer 2.5px: left=15.5 top=-6.5 right=104.5 bottom=74.5
  // Torace: x=22 y=72 w=76 h=56 → outer 2.5px: left=19.5 top=69.5 right=100.5 bottom=130.5
  const silhouette = [
    "M 20.5,-6.5",
    "L 99.5,-6.5",
    "Q 104.5,-6.5 104.5,-1.5",
    "L 104.5,72",
    "L 100.5,72",
    "L 100.5,125.5",
    "Q 100.5,130.5 95.5,130.5",
    "L 24.5,130.5",
    "Q 19.5,130.5 19.5,125.5",
    "L 19.5,72",
    "L 15.5,72",
    "L 15.5,-1.5",
    "Q 15.5,-6.5 20.5,-6.5",
    "Z",
  ].join(" ")

  return (
    <div
      className={`relative select-none pointer-events-none ${className}`}
      style={{ width: size, height: Math.round(size * 1.48) }}
      aria-hidden="true"
    >
      <style>{KEYFRAMES}</style>

      <svg
        viewBox="0 0 120 178"
        width={size}
        height={Math.round(size * 1.48)}
        xmlns="http://www.w3.org/2000/svg"
        overflow="visible"
      >
        {/* Ombra a terra */}
        <ellipse
          cx="60" cy="172" rx="28" ry="4.5" fill="#000"
          style={shadowAnim !== "none"
            ? { animation: shadowAnim, transformOrigin: "60px 172px" }
            : { opacity: 0.10 }}
        />

        <g style={bodyAnim !== "none"
          ? { animation: bodyAnim, transformOrigin: "60px 90px" }
          : undefined}>

          {/* ── Braccio sinistro ── */}
          <g>
            <path d="M 24 87 C 12 92 7 106 6 118"
              stroke={OUTLINE} strokeWidth="7" strokeLinecap="round" fill="none" />
            <circle cx="5" cy="120" r="9" fill="#f0f0f0" stroke={OUTLINE} strokeWidth="1.5" />
          </g>

          {/* ── Braccio destro ── */}
          <g style={{
            animation: isLoading ? "m-arm-r-sweep 1.4s ease-in-out infinite" : undefined,
            transform: isSuccess ? "rotate(-65deg)" : undefined,
            transformOrigin: "96px 86px",
          }}>
            <path d="M 96 86 C 108 90 113 104 114 116"
              stroke={OUTLINE} strokeWidth="7" strokeLinecap="round" fill="none" />
            <circle cx="115" cy="118" r="9" fill="#f0f0f0" stroke={OUTLINE} strokeWidth="1.5" />

            {isLoading && (
              <g style={{
                animation: "m-glass-sweep 1.4s ease-in-out infinite",
                transformOrigin: "115px 110px",
              }}>
                <circle cx="130" cy="92" r="13" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" />
                <circle cx="130" cy="92" r="13" fill="rgba(255,255,255,0.08)" />
                <line x1="124" y1="85" x2="120" y2="80"
                  stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="139" y1="101" x2="147" y2="111"
                  stroke="rgba(255,255,255,0.85)" strokeWidth="4" strokeLinecap="round" />
              </g>
            )}
          </g>

          {/* ══ SAGOMA UNICA testa+torace ══ */}
          <path d={silhouette} fill={OUTLINE} />

          {/* ══ TESTA ══ */}
          <rect x="18" y="-4" width="84" height="76" rx="3" fill="#00a1be" />

          {/* ── Occhi ── */}
          <g style={{ transformOrigin: "37px 46px", ...eyeBlinkStyle }}>
            <circle cx="37" cy="46" r="13" fill="#3a7a88" />
            <circle cx="37" cy="46" r="9"  fill="#151c28" />
          </g>
          <g style={{ transformOrigin: "83px 46px", ...eyeBlinkStyle }}>
            <circle cx="83" cy="46" r="13" fill="#3a7a88" />
            <circle cx="83" cy="46" r="9"  fill="#151c28" />
          </g>

          {/* ══ TORACE ══ */}
          <rect x="22" y="72" width="76" height="56" rx="3" fill="#009dba" />

          {/* ── Bocca ── */}
          <circle cx="60" cy="103" r="12" fill="#3a7a88" />
          <circle cx="60" cy="103" r="8"  fill="#151c28" />

          {/* ── Linea divisoria testa/torace: appena visibile ── */}
          <line x1="18" y1="72" x2="102" y2="72"
            stroke="rgba(255,255,255,0.20)" strokeWidth="0.8" />

          {/* ── Gambe ── */}
          <line x1="42" y1="128" x2="39" y2="157"
            stroke={OUTLINE} strokeWidth="7" strokeLinecap="round" />
          <line x1="78" y1="128" x2="81" y2="157"
            stroke={OUTLINE} strokeWidth="7" strokeLinecap="round" />

          {/* ── Piedi (ellissi semplici) ── */}
          <ellipse cx="37" cy="161" rx="15" ry="6.5"
            fill="#f0f0f0" stroke={OUTLINE} strokeWidth="1.5" />
          <ellipse cx="83" cy="161" rx="15" ry="6.5"
            fill="#f0f0f0" stroke={OUTLINE} strokeWidth="1.5" />

        </g>
      </svg>
    </div>
  )
}
