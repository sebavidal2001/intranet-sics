"use client";

/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Impostazioni dei grafici: palette, tema, densità, animazioni, formato dei
 * numeri, elementi visibili. Vivono in un contesto React e si conservano nel
 * browser, così chi apre il cruscotto lo ritrova come l'ha lasciato.
 *
 * Il principio resta quello dello strato semantico: i grafici non decidono
 * come apparire, lo leggono da qui. Cambiare palette è una riga, non venti.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Eye,
  Gauge,
  Palette,
  RotateCcw,
  Settings2,
  Sparkles,
  Type,
  X,
  Zap,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

export interface Palette {
  chiave: string;
  nome: string;
  descrizione: string;
  serie: string[];
  positivo: string;
  negativo: string;
  neutro: string;
  obiettivo: string;
  soglia: string;
}

export const PALETTE_DISPONIBILI: Palette[] = [
  {
    chiave: "sics",
    nome: "SICS",
    descrizione: "Azzurro aziendale, per l'uso quotidiano",
    serie: ["#00a1be", "#f59e0b", "#8b5cf6", "#22c55e", "#ef4444", "#0ea5e9", "#ec4899", "#64748b"],
    positivo: "#22c55e",
    negativo: "#ef4444",
    neutro: "#94a3b8",
    obiettivo: "#f59e0b",
    soglia: "#ef4444",
  },
  {
    chiave: "direzione",
    nome: "Direzione",
    descrizione: "Toni profondi e caldi, pensata per la proiezione",
    serie: ["#2563eb", "#f97316", "#14b8a6", "#a855f7", "#eab308", "#06b6d4", "#f43f5e", "#78716c"],
    positivo: "#10b981",
    negativo: "#f43f5e",
    neutro: "#a8a29e",
    obiettivo: "#f97316",
    soglia: "#f43f5e",
  },
  {
    chiave: "oceano",
    nome: "Oceano",
    descrizione: "Gradazioni fredde, ottima per le serie storiche",
    serie: ["#0ea5e9", "#0891b2", "#0d9488", "#4f46e5", "#7c3aed", "#2563eb", "#059669", "#475569"],
    positivo: "#0d9488",
    negativo: "#e11d48",
    neutro: "#94a3b8",
    obiettivo: "#6366f1",
    soglia: "#e11d48",
  },
  {
    chiave: "tramonto",
    nome: "Tramonto",
    descrizione: "Toni caldi, alta leggibilità sui grandi schermi",
    serie: ["#f97316", "#e11d48", "#d946ef", "#f59e0b", "#84cc16", "#06b6d4", "#8b5cf6", "#71717a"],
    positivo: "#84cc16",
    negativo: "#e11d48",
    neutro: "#a1a1aa",
    obiettivo: "#f59e0b",
    soglia: "#e11d48",
  },
  {
    chiave: "accessibile",
    nome: "Alto contrasto",
    descrizione: "Sequenza Okabe-Ito: distinguibile anche con daltonismo",
    serie: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#000000"],
    positivo: "#009E73",
    negativo: "#D55E00",
    neutro: "#999999",
    obiettivo: "#E69F00",
    soglia: "#D55E00",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stato
// ─────────────────────────────────────────────────────────────────────────────

export type Tema = "chiaro" | "scuro";
export type Densita = "comoda" | "compatta";

export interface Impostazioni {
  palette: string;
  tema: Tema;
  densita: Densita;
  mostraGriglia: boolean;
  mostraEtichette: boolean;
  mostraLegenda: boolean;
  numeriCompatti: boolean;
  animazioni: boolean;
  gradienti: boolean;
  bagliore: boolean;
  arrotondamento: number;
  topN: number;
}

export const IMPOSTAZIONI_INIZIALI: Impostazioni = {
  palette: "sics",
  tema: "chiaro",
  densita: "comoda",
  mostraGriglia: true,
  mostraEtichette: false,
  mostraLegenda: true,
  numeriCompatti: true,
  animazioni: true,
  gradienti: true,
  bagliore: false,
  arrotondamento: 4,
  topN: 12,
};

const CHIAVE_ARCHIVIO = "proto-bi:impostazioni:v1";

interface Contesto {
  imp: Impostazioni;
  palette: Palette;
  imposta: <K extends keyof Impostazioni>(chiave: K, valore: Impostazioni[K]) => void;
  reimposta: () => void;
  /** Colore della serie i-esima, ciclico sulla palette scelta. */
  colore: (i: number) => string;
  /** Durata delle animazioni: 0 quando sono disattivate. */
  durata: number;
  scuro: boolean;
}

const ContestoImpostazioni = createContext<Contesto | null>(null);

export function ImpostazioniProvider({ children }: { children: React.ReactNode }) {
  const [imp, setImp] = useState<Impostazioni>(IMPOSTAZIONI_INIZIALI);

  // Il ripristino avviene dopo il primo render: leggere localStorage durante
  // il render romperebbe l'idratazione lato server.
  useEffect(() => {
    try {
      const salvate = window.localStorage.getItem(CHIAVE_ARCHIVIO);
      if (salvate) setImp({ ...IMPOSTAZIONI_INIZIALI, ...JSON.parse(salvate) });
    } catch {
      // Modalità privata o storage bloccato: si resta ai valori iniziali.
    }
  }, []);

  const imposta = useCallback(
    <K extends keyof Impostazioni>(chiave: K, valore: Impostazioni[K]) => {
      setImp((prec) => {
        const nuove = { ...prec, [chiave]: valore };
        try {
          window.localStorage.setItem(CHIAVE_ARCHIVIO, JSON.stringify(nuove));
        } catch {
          // Ignorabile: le impostazioni restano valide per la sessione.
        }
        return nuove;
      });
    },
    []
  );

  const reimposta = useCallback(() => {
    setImp(IMPOSTAZIONI_INIZIALI);
    try {
      window.localStorage.removeItem(CHIAVE_ARCHIVIO);
    } catch {
      // idem
    }
  }, []);

  const palette = useMemo(
    () => PALETTE_DISPONIBILI.find((p) => p.chiave === imp.palette) ?? PALETTE_DISPONIBILI[0],
    [imp.palette]
  );

  const valore = useMemo<Contesto>(
    () => ({
      imp,
      palette,
      imposta,
      reimposta,
      colore: (i: number) => palette.serie[i % palette.serie.length],
      durata: imp.animazioni ? 600 : 0,
      scuro: imp.tema === "scuro",
    }),
    [imp, palette, imposta, reimposta]
  );

  return (
    <ContestoImpostazioni.Provider value={valore}>{children}</ContestoImpostazioni.Provider>
  );
}

/**
 * I grafici possono essere montati anche fuori dal provider (nei test, o in
 * un'anteprima isolata): in quel caso si usano i valori iniziali invece di
 * far esplodere il componente.
 */
export function useImpostazioni(): Contesto {
  const ctx = useContext(ContestoImpostazioni);
  const ripiego = useMemo<Contesto>(() => {
    const p = PALETTE_DISPONIBILI[0];
    return {
      imp: IMPOSTAZIONI_INIZIALI,
      palette: p,
      imposta: () => {},
      reimposta: () => {},
      colore: (i: number) => p.serie[i % p.serie.length],
      durata: 600,
      scuro: false,
    };
  }, []);
  return ctx ?? ripiego;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pannello
// ─────────────────────────────────────────────────────────────────────────────

function Interruttore({
  etichetta,
  descrizione,
  attivo,
  onCambia,
}: {
  etichetta: string;
  descrizione?: string;
  attivo: boolean;
  onCambia: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onCambia(!attivo)}
      className="w-full flex items-start justify-between gap-3 py-2 text-left group"
      role="switch"
      aria-checked={attivo}
    >
      <span className="min-w-0">
        <span className="block text-sm">{etichetta}</span>
        {descrizione && (
          <span className="block text-[11px] text-text-muted mt-0.5">{descrizione}</span>
        )}
      </span>
      <span
        className={`shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors relative ${
          attivo ? "bg-primary" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            attivo ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function Sezione({
  icona: Icona,
  titolo,
  children,
}: {
  icona: typeof Palette;
  titolo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-3 border-b border-border last:border-0">
      <h3 className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-tenorite text-text-muted mb-2">
        <Icona className="w-3.5 h-3.5" aria-hidden />
        {titolo}
      </h3>
      {children}
    </section>
  );
}

export function PannelloImpostazioni() {
  const { imp, palette, imposta, reimposta } = useImpostazioni();
  const [aperto, setAperto] = useState(false);

  return (
    <>
      <button
        onClick={() => setAperto(true)}
        className="p-2 rounded-lg border border-border hover:bg-bg-page transition-colors"
        aria-label="Impostazioni grafici"
        title="Impostazioni grafici"
      >
        <Settings2 className="w-4 h-4" aria-hidden />
      </button>

      <AnimatePresence>
        {aperto && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAperto(false)}
              className="fixed inset-0 bg-black/30 z-40"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-bg border-l border-border z-50 overflow-y-auto"
            >
              <header className="sticky top-0 bg-bg border-b border-border px-4 py-3 flex items-center justify-between">
                <h2 className="font-tenorite font-semibold">Impostazioni grafici</h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={reimposta}
                    className="p-1.5 rounded text-text-muted hover:text-text hover:bg-bg-page"
                    title="Ripristina i valori iniziali"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden />
                  </button>
                  <button
                    onClick={() => setAperto(false)}
                    className="p-1.5 rounded text-text-muted hover:text-text hover:bg-bg-page"
                    aria-label="Chiudi"
                  >
                    <X className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              </header>

              <div className="px-4 pb-8">
                <Sezione icona={Palette} titolo="Palette">
                  <div className="space-y-1.5">
                    {PALETTE_DISPONIBILI.map((p) => {
                      const scelta = p.chiave === imp.palette;
                      return (
                        <button
                          key={p.chiave}
                          onClick={() => imposta("palette", p.chiave)}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg border transition-colors text-left ${
                            scelta
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-bg-page"
                          }`}
                        >
                          <span className="flex shrink-0 rounded overflow-hidden">
                            {p.serie.slice(0, 6).map((c) => (
                              <span key={c} className="w-3.5 h-7" style={{ background: c }} />
                            ))}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{p.nome}</span>
                            <span className="block text-[11px] text-text-muted truncate">
                              {p.descrizione}
                            </span>
                          </span>
                          {scelta && <Check className="w-4 h-4 text-primary shrink-0" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                </Sezione>

                <Sezione icona={Sparkles} titolo="Aspetto">
                  <div className="grid grid-cols-2 gap-2 mb-1">
                    {(["chiaro", "scuro"] as Tema[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => imposta("tema", t)}
                        className={`py-2 text-sm rounded-lg border capitalize transition-colors ${
                          imp.tema === t
                            ? "border-primary bg-primary/5 text-primary font-medium"
                            : "border-border hover:bg-bg-page"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {(["comoda", "compatta"] as Densita[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => imposta("densita", d)}
                        className={`py-2 text-sm rounded-lg border capitalize transition-colors ${
                          imp.densita === d
                            ? "border-primary bg-primary/5 text-primary font-medium"
                            : "border-border hover:bg-bg-page"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <Interruttore
                    etichetta="Sfumature"
                    descrizione="Riempimenti sfumati al posto delle tinte piatte"
                    attivo={imp.gradienti}
                    onCambia={(v) => imposta("gradienti", v)}
                  />
                  <Interruttore
                    etichetta="Bagliore"
                    descrizione="Alone luminoso sulle serie: efficace sul monitor in sala"
                    attivo={imp.bagliore}
                    onCambia={(v) => imposta("bagliore", v)}
                  />
                  <div className="pt-2">
                    <label className="text-sm block mb-1">
                      Arrotondamento angoli
                      <span className="text-text-muted ml-2 tabular-nums">
                        {imp.arrotondamento} px
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={12}
                      value={imp.arrotondamento}
                      onChange={(e) => imposta("arrotondamento", Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>
                </Sezione>

                <Sezione icona={Eye} titolo="Elementi visibili">
                  <Interruttore
                    etichetta="Griglia"
                    attivo={imp.mostraGriglia}
                    onCambia={(v) => imposta("mostraGriglia", v)}
                  />
                  <Interruttore
                    etichetta="Etichette dei valori"
                    descrizione="Il numero stampato sopra ogni barra"
                    attivo={imp.mostraEtichette}
                    onCambia={(v) => imposta("mostraEtichette", v)}
                  />
                  <Interruttore
                    etichetta="Legenda"
                    attivo={imp.mostraLegenda}
                    onCambia={(v) => imposta("mostraLegenda", v)}
                  />
                </Sezione>

                <Sezione icona={Type} titolo="Numeri">
                  <Interruttore
                    etichetta="Formato compatto"
                    descrizione="1,3 M€ invece di 1.267.923 €"
                    attivo={imp.numeriCompatti}
                    onCambia={(v) => imposta("numeriCompatti", v)}
                  />
                  <div className="pt-2">
                    <label className="text-sm block mb-1">
                      Voci mostrate nei grafici
                      <span className="text-text-muted ml-2 tabular-nums">{imp.topN}</span>
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={30}
                      value={imp.topN}
                      onChange={(e) => imposta("topN", Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>
                </Sezione>

                <Sezione icona={Zap} titolo="Animazioni">
                  <Interruttore
                    etichetta="Animazioni attive"
                    descrizione="Disattivarle rende il cruscotto più reattivo sui monitor lenti"
                    attivo={imp.animazioni}
                    onCambia={(v) => imposta("animazioni", v)}
                  />
                </Sezione>

                <div className="pt-4 flex items-center gap-2 text-[11px] text-text-muted">
                  <Gauge className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span>
                    Palette attiva: <strong>{palette.nome}</strong>. Le impostazioni restano
                    su questo browser.
                  </span>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Selettore del tipo di grafico, per singolo pannello
// ─────────────────────────────────────────────────────────────────────────────

export type TipoGrafico =
  | "barre"
  | "barre_orizzontali"
  | "linee"
  | "area"
  | "torta"
  | "treemap"
  | "tabella";

const NOMI_TIPO: Record<TipoGrafico, string> = {
  barre: "Barre",
  barre_orizzontali: "Barre orizzontali",
  linee: "Linee",
  area: "Area",
  torta: "Torta",
  treemap: "Treemap",
  tabella: "Tabella",
};

export function SelettoreTipoGrafico({
  tipo,
  disponibili,
  onCambia,
}: {
  tipo: TipoGrafico;
  disponibili: TipoGrafico[];
  onCambia: (t: TipoGrafico) => void;
}) {
  if (disponibili.length < 2) return null;
  return (
    <div className="flex gap-0.5 p-0.5 rounded-md bg-bg-page">
      {disponibili.map((t) => (
        <button
          key={t}
          onClick={() => onCambia(t)}
          title={NOMI_TIPO[t]}
          className={`px-2 py-1 text-[10px] rounded transition-colors ${
            tipo === t
              ? "bg-bg shadow-sm text-primary font-semibold"
              : "text-text-muted hover:text-text"
          }`}
        >
          {NOMI_TIPO[t]}
        </button>
      ))}
    </div>
  );
}
