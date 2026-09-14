"use client";

/**
 *
 * Il cruscotto. Rispetto al PBIX cambia soprattutto una cosa: qui si clicca.
 * Ogni barra, fetta, cella o riga aggiunge un filtro che si propaga a tutta
 * la pagina — il filtro incrociato che in Power BI si dà per scontato — e i
 * filtri attivi restano visibili come etichette rimovibili.
 *
 * Le sei viste rispondono a sei domande diverse:
 *   Sintesi      → dove siamo rispetto all'obiettivo
 *   Scostamenti  → da dove viene la differenza
 *   Clienti      → da chi dipendiamo e chi si sta muovendo
 *   Preventivi   → cosa c'è in canna
 *   Conversione  → che fine fanno i preventivi
 *   Back office  → quanto lavorano gli addetti e con che tempi
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Filter,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  RefreshCw,
  X,
} from "lucide-react";
import { RaccordoCruscottoDashboard } from "./raccordo-cruscotto-dashboard";
import {
  GraficoCombo,
  GraficoLinee,
  GraficoTorta,
  KpiEroe,
  Scheda,
  useQueryBi,
  euro,
} from "./primitivi";
import {
  BarreScostamento,
  Bullet,
  Heatmap,
  Multipli,
  Pareto,
  Quadranti,
  Waterfall,
} from "./grafici-avanzati";
import {
  TabellaAnalitica,
  colonneConfronto,
  costruisciConfronto,
} from "./tabella-analitica";
import { PannelloImpostazioni, useImpostazioni } from "./impostazioni";
import { VistaConversione } from "./vista-conversione";
import { VistaBackoffice } from "./vista-backoffice";
import type { Dimensione, RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

type Vista =
  | "sintesi"
  | "scostamenti"
  | "clienti"
  | "preventivi"
  | "conversione"
  | "backoffice";

const VISTE: { chiave: Vista; etichetta: string; nota: string }[] = [
  { chiave: "sintesi", etichetta: "Sintesi", nota: "dove siamo rispetto all'obiettivo" },
  { chiave: "scostamenti", etichetta: "Scostamenti", nota: "da dove viene la differenza" },
  { chiave: "clienti", etichetta: "Clienti", nota: "da chi dipendiamo, chi si muove" },
  { chiave: "preventivi", etichetta: "Preventivi", nota: "cosa c'è in canna" },
  { chiave: "conversione", etichetta: "Conversione", nota: "che fine fanno i preventivi" },
  { chiave: "backoffice", etichetta: "Back office", nota: "carico e tempi degli addetti" },
];

/** Secondi per schermata nella modalità presentazione. */
const SECONDI_ROTAZIONE = 20;

/**
 * Giorno a cui fermare il confronto quando è attivo il periodo su periodo.
 *
 * Prende il giorno-mese dell'ultimo dato disponibile e lo applica all'anno
 * scelto: così il 2026 al 28 agosto si confronta con il 2025 al 28 agosto, e
 * non con il 2025 intero. Senza, ogni delta di un anno in corso è falso per
 * costruzione — mostra un calo che è solo il tempo che manca.
 */
function giornoLimite(anno: number, dataMassima: string | null): string {
  if (!dataMassima) return `${anno}-12-31`;
  return `${anno}-${dataMassima.slice(5, 10)}`;
}

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

interface FiltroAttivo {
  campo: Dimensione;
  valore: string;
}

const NOMI_DIMENSIONE: Record<string, string> = {
  bu: "Business unit",
  agente: "Agente",
  cliente: "Cliente",
  categoria: "Categoria",
  causale: "Causale",
  articolo: "Articolo",
  creatore: "Addetto",
  esito: "Esito",
};

export function CruscottoView({
  anniDisponibili,
  dataMassima,
  runRicevutoIl,
  tassonomiaBu,
}: {
  anniDisponibili: number[];
  buDisponibili?: string[];
  agentiDisponibili?: string[];
  dataMassima: string | null;
  runRicevutoIl: string | null;
  /** Esito del controllo sulle business unit riconciliate. */
  tassonomiaBu?: { coerente: boolean; estranei: string[] } | null;
}) {
  const [vista, setVista] = useState<Vista>("sintesi");
  const [anno, setAnno] = useState<number>(anniDisponibili[0] ?? new Date().getFullYear());
  const [filtri, setFiltri] = useState<FiltroAttivo[]>([]);
  const [schermoIntero, setSchermoIntero] = useState(false);
  const [presentazione, setPresentazione] = useState(false);
  // Predefinito ACCESO: il confronto a periodo pieno è quello sbagliato, e
  // lasciarlo come impostazione iniziale significa mostrare per primo il
  // numero fuorviante.
  const [ytd, setYtd] = useState(true);
  const [esportando, setEsportando] = useState(false);
  const { imp, scuro } = useImpostazioni();

  // Modalità presentazione: schermo intero e rotazione automatica delle
  // schermate, per il monitor in sala riunioni.
  useEffect(() => {
    if (!presentazione) return;
    const id = window.setInterval(() => {
      setVista((v) => {
        const i = VISTE.findIndex((x) => x.chiave === v);
        return VISTE[(i + 1) % VISTE.length].chiave;
      });
    }, SECONDI_ROTAZIONE * 1000);
    return () => window.clearInterval(id);
  }, [presentazione]);

  // Esc esce dallo schermo intero: senza, in presentazione si resta bloccati.
  useEffect(() => {
    const onTasto = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPresentazione(false);
      setSchermoIntero(false);
    };
    window.addEventListener("keydown", onTasto);
    return () => window.removeEventListener("keydown", onTasto);
  }, []);

  /** Un click su un elemento aggiunge (o toglie) un filtro. */
  const alternaFiltro = useCallback((campo: Dimensione, valore: string) => {
    setFiltri((f) => {
      const esistente = f.find((x) => x.campo === campo);
      if (esistente?.valore === valore) return f.filter((x) => x.campo !== campo);
      return [...f.filter((x) => x.campo !== campo), { campo, valore }];
    });
  }, []);

  const filtroDi = (campo: Dimensione) => filtri.find((f) => f.campo === campo)?.valore ?? null;

  const filtriSpec = useMemo(
    () => filtri.map((f) => ({ campo: f.campo, op: "eq" as const, valore: f.valore })),
    [filtri]
  );

  const alGiorno = useMemo(
    () =>
      dataMassima && dataMassima.startsWith(String(anno)) ? dataMassima : `${anno}-12-31`,
    [anno, dataMassima]
  );
  const limiteYtd = useMemo(() => giornoLimite(anno, dataMassima), [anno, dataMassima]);

  // Con YTD acceso ogni metrica si ferma allo stesso giorno dell'anno; il
  // modificatore "anno_precedente" sposta indietro sia l'inizio sia la fine,
  // quindi il confronto resta a parità di periodo.
  const periodo = useMemo(
    () => (ytd ? { dal: `${anno}-01-01`, al: limiteYtd } : { anno }),
    [ytd, anno, limiteYtd]
  );
  const periodoProg = useMemo(() => ({ dal: `${anno}-01-01`, al: alGiorno }), [anno, alGiorno]);

  // ── Le spec: il cruscotto resta dichiarativo ──────────────────────────────
  const specs = useMemo<Record<string, SpecQuery | null>>(() => {
    const base = { filtri: filtriSpec, periodo };
    const comuni: Record<string, SpecQuery | null> = {
      ordinatoTot: { metrica: "ordinato", ...base },
      ordinatoAP: { metrica: "ordinato", modificatore: "anno_precedente", ...base },
      fatturatoTot: { metrica: "fatturato", ...base },
      fatturatoAP: { metrica: "fatturato", modificatore: "anno_precedente", ...base },
      nOrdini: { metrica: "n_ordini", ...base },
      ordineMedio: { metrica: "ordine_medio", ...base },
      // Budget "a oggi": confrontare il progressivo con il budget dell'anno
      // intero è l'errore che fa sembrare tutti sotto obiettivo a maggio.
      budgetAdOggi: { metrica: "budget", filtri: filtriSpec, periodo: periodoProg },
      bepAdOggi: { metrica: "bep", filtri: filtriSpec, periodo: periodoProg },
      budgetAnno: { metrica: "budget", filtri: filtriSpec, periodo },
      // Il portafoglio è una fotografia degli ordini ancora da consegnare:
      // non va tagliato al solo anno selezionato e non va sommato alle
      // consegne future, che sono la stessa origine ripartita per mese.
      portafoglioTot: { metrica: "portafoglio", filtri: filtriSpec },
    };

    // Conversione e back office interrogano autonomamente i propri grafici,
    // ma la fascia KPI generale resta visibile. Prima tornavamo `{}` qui:
    // l'effetto era una fila di zeri non calcolati su entrambe le pagine.
    if (vista === "conversione" || vista === "backoffice") return comuni;

    if (vista === "sintesi") {
      return {
        ...comuni,
        ordinatoBu: { metrica: "ordinato", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
        budgetBuAdOggi: {
          metrica: "budget",
          raggruppa: ["bu"],
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        bepBuAdOggi: { metrica: "bep", raggruppa: ["bu"], filtri: filtriSpec, periodo: periodoProg },
        ordinatoMese: { metrica: "ordinato", granularita: "mese", ...base, ordina: "etichetta" },
        budgetMese: { metrica: "budget", granularita: "mese", filtri: filtriSpec, periodo, ordina: "etichetta" },
        bepMese: { metrica: "bep", granularita: "mese", filtri: filtriSpec, periodo, ordina: "etichetta" },
        ordinatoProgSett: {
          metrica: "ordinato",
          modificatore: "progressivo",
          granularita: "settimana",
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        budgetProgSett: {
          metrica: "budget",
          modificatore: "progressivo",
          granularita: "settimana",
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        bepProgSett: {
          metrica: "bep",
          modificatore: "progressivo",
          granularita: "settimana",
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        ordinatoBuMese: {
          metrica: "ordinato",
          granularita: "mese",
          raggruppa: ["bu"],
          ...base,
          ordina: "etichetta",
        },
      };
    }

    if (vista === "scostamenti") {
      return {
        ...comuni,
        ordinatoBu: { metrica: "ordinato", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
        ordinatoBuAP: {
          metrica: "ordinato",
          modificatore: "anno_precedente",
          raggruppa: ["bu"],
          ...base,
          ordina: "valore_desc",
        },
        ordinatoAgente: { metrica: "ordinato", raggruppa: ["agente"], ...base, ordina: "valore_desc" },
        ordinatoAgenteAP: {
          metrica: "ordinato",
          modificatore: "anno_precedente",
          raggruppa: ["agente"],
          ...base,
          ordina: "valore_desc",
        },
        budgetBuAdOggi: {
          metrica: "budget",
          raggruppa: ["bu"],
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        budgetAgenteAdOggi: {
          metrica: "budget",
          raggruppa: ["agente"],
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        ordinatoBuMese: {
          metrica: "ordinato",
          granularita: "mese",
          raggruppa: ["bu"],
          ...base,
          ordina: "etichetta",
        },
        budgetBuMese: {
          metrica: "budget",
          granularita: "mese",
          raggruppa: ["bu"],
          filtri: filtriSpec,
          periodo,
          ordina: "etichetta",
        },
      };
    }

    if (vista === "clienti") {
      return {
        ...comuni,
        clienti: { metrica: "ordinato", raggruppa: ["cliente"], ...base, ordina: "valore_desc", limite: 200 },
        clientiAP: {
          metrica: "ordinato",
          modificatore: "anno_precedente",
          raggruppa: ["cliente"],
          ...base,
          ordina: "valore_desc",
          limite: 400,
        },
        clientiMese: {
          metrica: "ordinato",
          granularita: "mese",
          raggruppa: ["cliente"],
          ...base,
          ordina: "etichetta",
        },
        ordinatoAgente: { metrica: "ordinato", raggruppa: ["agente"], ...base, ordina: "valore_desc" },
        // La scheda disegna anche la torta per business unit: senza questa
        // riga il pannello restava a scheletro per sempre, e uno scheletro
        // dice «sto caricando», non «questo dato nessuno l'ha chiesto».
        ordinatoBu: { metrica: "ordinato", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
      };
    }

    return {
      ...comuni,
      preventiviTot: { metrica: "preventivi_aperti", filtri: filtriSpec },
      nPreventivi: { metrica: "n_preventivi", filtri: filtriSpec },
      preventiviBu: { metrica: "preventivi_aperti", raggruppa: ["bu"], filtri: filtriSpec, ordina: "valore_desc" },
      preventiviAgente: {
        metrica: "preventivi_aperti",
        raggruppa: ["agente"],
        filtri: filtriSpec,
        ordina: "valore_desc",
      },
      preventiviCausale: {
        metrica: "preventivi_aperti",
        raggruppa: ["causale"],
        filtri: filtriSpec,
        ordina: "valore_desc",
      },
      preventiviCliente: {
        metrica: "preventivi_aperti",
        raggruppa: ["cliente"],
        filtri: filtriSpec,
        ordina: "valore_desc",
        limite: 200,
      },
      preventiviCausaleMese: {
        metrica: "preventivi_aperti",
        granularita: "mese",
        raggruppa: ["causale"],
        filtri: filtriSpec,
        ordina: "etichetta",
      },
      portafoglioMese: {
        metrica: "consegnato_futuro",
        granularita: "mese",
        filtri: filtriSpec,
        ordina: "etichetta",
      },
    };
  }, [vista, filtriSpec, periodo, periodoProg]);

  const { risultati, caricamento, errori, ricarica } = useQueryBi(specs);
  /**
   * Legge un risultato del batch.
   *
   * Con il guardiano acceso: chiedere una chiave che questa vista **non ha
   * richiesto** non e' un dato mancante, e' un errore di programmazione. Senza
   * segnalarlo il pannello resta a scheletro per sempre, e uno scheletro dice
   * «sto caricando», non «questo dato nessuno l'ha chiesto» — che e' esattamente
   * come la torta per business unit e' rimasta vuota nella scheda Clienti senza
   * che nessuno se ne accorgesse.
   *
   * Solo in sviluppo: in produzione un pannello vuoto e' meglio di una pagina
   * che non si apre.
   */
  /**
   * Lettura permissiva, per i calcoli derivati.
   *
   * I derivati (waterfall, tabelle di confronto, multipli) sono `useMemo` che
   * girano a ogni render qualunque sia la scheda aperta, e leggono chiavi che
   * solo *alcune* schede richiedono. Li' l'assenza e' normale e il risultato
   * viene semplicemente vuoto: segnalarla renderebbe il guardiano rumoroso
   * fino a farlo ignorare.
   */
  const rSeCe = (k: string) => risultati[k];

  const r = (k: string) => {
    if (process.env.NODE_ENV !== "production" && !(k in specs)) {
      console.error(
        `[cruscotto] la vista "${vista}" disegna "${k}" ma non lo chiede: ` +
          "aggiungilo al blocco delle richieste, altrimenti resta a scheletro per sempre."
      );
    }
    return risultati[k];
  };
  const tot = (k: string) => risultati[k]?.totale ?? 0;

  // ── Derivati per i grafici analitici ──────────────────────────────────────

  /** Voci del waterfall: contributo di ogni chiave alla variazione. */
  const vociWaterfall = useCallback(
    (corrente?: RisultatoQuery, precedente?: RisultatoQuery) => {
      if (!corrente) return [];
      const ap = new Map(precedente?.righe.map((x) => [x.etichetta, x.valore]) ?? []);
      const chiavi = new Set([
        ...corrente.righe.map((x) => x.etichetta),
        ...(precedente?.righe.map((x) => x.etichetta) ?? []),
      ]);
      return [...chiavi]
        .map((k) => ({
          etichetta: k,
          delta:
            (corrente.righe.find((x) => x.etichetta === k)?.valore ?? 0) - (ap.get(k) ?? 0),
        }))
        .filter((v) => Math.abs(v.delta) > 1);
    },
    []
  );

  /** Righe bullet: consuntivo contro budget e BEP, a pari periodo. */
  const righeBullet = useMemo(() => {
    const ord = r("ordinatoBu");
    const bdg = r("budgetBuAdOggi");
    const bep = r("bepBuAdOggi");
    if (!ord || !bdg) return [];
    const mb = new Map(bdg.righe.map((x) => [x.etichetta, x.valore]));
    const mbep = new Map(bep?.righe.map((x) => [x.etichetta, x.valore]) ?? []);
    return ord.righe
      .filter((x) => (mb.get(x.etichetta) ?? 0) > 0)
      .map((x) => ({
        etichetta: x.etichetta,
        valore: x.valore,
        obiettivo: mb.get(x.etichetta) ?? 0,
        soglia: mbep.get(x.etichetta) ?? null,
      }));
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Heatmap business unit × mese, colorata sullo scostamento dal budget. */
  const heatmapScostamenti = useMemo(() => {
    const ord = r("ordinatoBuMese");
    const bdg = rSeCe("budgetBuMese");
    if (!ord) return null;

    const bu = [...new Set(ord.righe.map((x) => x.chiavi.bu).filter(Boolean))] as string[];
    const mesiPresenti = [...new Set(ord.righe.map((x) => x.chiavi.periodo).filter(Boolean))].sort() as string[];
    if (bu.length === 0 || mesiPresenti.length === 0) return null;

    const mappaB = new Map(
      (bdg?.righe ?? []).map((x) => [`${x.chiavi.bu}|${x.chiavi.periodo}`, x.valore])
    );

    const valori: Record<string, Record<string, number>> = {};
    for (const b of bu) {
      valori[b] = {};
      for (const m of mesiPresenti) {
        const riga = ord.righe.find((x) => x.chiavi.bu === b && x.chiavi.periodo === m);
        const effettivo = riga?.valore ?? 0;
        const budget = mappaB.get(`${b}|${m}`) ?? 0;
        // Senza budget si mostra lo scostamento assoluto in euro; con budget,
        // la percentuale, che è il modo in cui la direzione lo legge.
        valori[b][MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m] =
          budget > 0 ? ((effettivo - budget) / budget) * 100 : 0;
      }
    }

    return {
      righe: bu,
      colonne: mesiPresenti.map((m) => MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m),
      valori,
      conBudget: Boolean(bdg && bdg.righe.length > 0),
    };
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Punti dei quadranti: valore anno precedente contro crescita. */
  const puntiQuadranti = useMemo(() => {
    const cur = rSeCe("clienti");
    const ap = rSeCe("clientiAP");
    if (!cur || !ap) return [];
    const mappaAP = new Map(ap.righe.map((x) => [x.etichetta, x.valore]));
    return cur.righe
      .map((x) => {
        const precedente = mappaAP.get(x.etichetta) ?? 0;
        if (precedente < 5000) return null; // troppo piccoli: sono rumore
        return {
          nome: x.etichetta,
          x: precedente,
          y: ((x.valore - precedente) / precedente) * 100,
          dimensione: x.valore,
        };
      })
      .filter(Boolean)
      .slice(0, 120) as { nome: string; x: number; y: number; dimensione: number }[];
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Piccoli multipli per business unit. */
  const multipliBu = useMemo(() => {
    const serie = r("ordinatoBuMese");
    const cur = r("ordinatoBu");
    if (!serie || !cur) return [];
    const bu = [...new Set(serie.righe.map((x) => x.chiavi.bu).filter(Boolean))] as string[];
    return bu.map((b) => {
      const valori = serie.righe
        .filter((x) => x.chiavi.bu === b)
        .map((x) => ({ periodo: x.chiavi.periodo ?? "", valore: x.valore }))
        .sort((a, z) => a.periodo.localeCompare(z.periodo));
      return {
        nome: b,
        valori,
        totale: cur.righe.find((x) => x.etichetta === b)?.valore ?? 0,
        variazionePct: null,
      };
    });
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  function tabellaDi(
    chiaveCorrente: string,
    chiaveAP: string,
    chiaveBudget: string | null,
    chiaveSerie: string | null,
    dimensione: string
  ) {
    return costruisciConfronto({
      corrente: r(chiaveCorrente),
      precedente: r(chiaveAP),
      budget: chiaveBudget ? r(chiaveBudget) : undefined,
      serie: chiaveSerie ? r(chiaveSerie) : undefined,
      dimensione,
    });
  }

  async function esporta() {
    setEsportando(true);
    try {
      const blocchi = Object.entries(specs)
        .filter(([, s]) => s !== null)
        .slice(0, 12)
        .map(([id, s]) => ({ titolo: id, spec: s }));
      const res = await fetch("/api/bi/esporta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "query-excel", blocchi }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Errore");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BI_Cruscotto_${vista}_${anno}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setEsportando(false);
    }
  }

  const budgetMancante = (r("budgetAdOggi")?.avvisi ?? []).some((a) => a.includes("non disponibili"));

  return (
    <div
      className={[
        schermoIntero ? "fixed inset-0 z-40 overflow-auto" : "",
        scuro ? "proto-bi-scuro bg-slate-950 text-slate-100" : schermoIntero ? "bg-bg-page" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Il tema scuro ridefinisce i token del design system solo dentro il
          cruscotto: il resto dell'intranet resta chiaro. */}
      {scuro && (
        <style>{`
          .proto-bi-scuro {
            --color-bg: #0f172a;
            --color-bg-page: #1e293b;
            --color-border: #334155;
            --color-text: #f1f5f9;
            --color-text-muted: #94a3b8;
          }
        `}</style>
      )}
      <div
        className={`max-w-[1600px] mx-auto px-4 ${
          imp.densita === "compatta" ? "py-3" : "py-6"
        }`}
      >
        <RaccordoCruscottoDashboard />
        {presentazione && (
          <div className="mb-3 flex items-center gap-2 text-xs text-primary">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            Presentazione attiva — la schermata cambia ogni {SECONDI_ROTAZIONE} secondi. Esc per
            uscire.
          </div>
        )}
        {/* ── Barra comandi ──────────────────────────────────────────────── */}
        <div className="flex items-end gap-3 flex-wrap mb-3">
          <div className="flex gap-1 p-1 rounded-lg bg-bg-page">
            {VISTE.map((v) => (
              <button
                key={v.chiave}
                onClick={() => setVista(v.chiave)}
                title={v.nota}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  vista === v.chiave
                    ? "bg-bg shadow-sm font-semibold text-primary"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {v.etichetta}
              </button>
            ))}
          </div>

          <label className="text-xs text-text-muted">
            <span className="block mb-1">Anno</span>
            <select
              value={anno}
              onChange={(e) => setAnno(Number(e.target.value))}
              className="px-2 py-1.5 text-sm rounded-lg border border-border bg-bg"
            >
              {anniDisponibili.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-text-muted">
            <span className="block mb-1">Confronto</span>
            <button
              onClick={() => setYtd((v) => !v)}
              title={
                ytd
                  ? `Periodo su periodo: entrambi gli anni fermati al ${limiteYtd.slice(8, 10)}/${limiteYtd.slice(5, 7)}`
                  : "Anno intero contro anno intero: su un anno in corso il confronto è falsato"
              }
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                ytd
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-warning/50 bg-warning/10 text-warning"
              }`}
            >
              {ytd
                ? `Periodo su periodo (al ${limiteYtd.slice(8, 10)}/${limiteYtd.slice(5, 7)})`
                : "Anno intero"}
            </button>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={ricarica}
              className="p-2 rounded-lg border border-border hover:bg-bg-page"
              aria-label="Ricarica"
            >
              {caricamento ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="w-4 h-4" aria-hidden />
              )}
            </button>
            <button
              onClick={() => void esporta()}
              disabled={esportando}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-bg-page disabled:opacity-50"
            >
              {esportando ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : (
                <Download className="w-4 h-4" aria-hidden />
              )}
              Excel
            </button>
            <PannelloImpostazioni />
            <button
              onClick={() => {
                const attiva = !presentazione;
                setPresentazione(attiva);
                if (attiva) setSchermoIntero(true);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-sm rounded-lg border transition-colors ${
                presentazione
                  ? "border-primary bg-primary text-white"
                  : "border-border hover:bg-bg-page"
              }`}
              title={`Presentazione: cambia schermata ogni ${SECONDI_ROTAZIONE} secondi`}
            >
              {presentazione ? (
                <Pause className="w-4 h-4" aria-hidden />
              ) : (
                <Play className="w-4 h-4" aria-hidden />
              )}
            </button>
            <button
              onClick={() => setSchermoIntero((v) => !v)}
              className="p-2 rounded-lg border border-border hover:bg-bg-page"
              aria-label={schermoIntero ? "Esci da schermo intero" : "Schermo intero"}
            >
              {schermoIntero ? (
                <Minimize2 className="w-4 h-4" aria-hidden />
              ) : (
                <Maximize2 className="w-4 h-4" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {/* ── Filtri incrociati attivi ───────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap mb-4 min-h-[30px]">
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <Filter className="w-3.5 h-3.5" aria-hidden />
            {filtri.length === 0
              ? "Clicca su un elemento di un grafico o di una tabella per filtrare tutto"
              : "Filtri attivi:"}
          </span>
          {filtri.map((f) => (
            <motion.button
              key={`${f.campo}-${f.valore}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => setFiltri((x) => x.filter((y) => y.campo !== f.campo))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors"
            >
              <span className="opacity-70">{NOMI_DIMENSIONE[f.campo] ?? f.campo}:</span>
              <strong className="max-w-[180px] truncate">{f.valore}</strong>
              <X className="w-3 h-3" aria-hidden />
            </motion.button>
          ))}
          {filtri.length > 1 && (
            <button
              onClick={() => setFiltri([])}
              className="text-xs text-text-muted hover:text-danger underline"
            >
              azzera tutti
            </button>
          )}
        </div>

        {errori._generale && (
          <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
            {errori._generale}
          </div>
        )}
        {tassonomiaBu && !tassonomiaBu.coerente && (
          <div className="mb-4 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            <strong>Business unit non riconosciute:</strong>{" "}
            {tassonomiaBu.estranei.join(", ")}. Il gestionale ha introdotto un gruppo o una
            categoria che la regola di riconciliazione non copre: le ripartizioni per business
            unit vanno lette con cautela finché la regola non viene aggiornata.
          </div>
        )}
        {budgetMancante && (
          <div className="mb-4 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            Budget e BEP non disponibili per il {anno}:{" "}
            <a href="/bi/configurazione" className="text-primary underline">
              importa il file Excel
            </a>{" "}
            per vedere scostamenti e raggiungimento.
          </div>
        )}

        {/* ── Fascia KPI ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl bg-slate-900 text-white p-5 lg:p-6 mb-5 grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-6"
        >
          <KpiEroe
            scuro
            etichetta={ytd ? `Ordinato ${anno} a oggi` : `Ordinato ${anno}`}
            valore={r("ordinatoTot") ? tot("ordinatoTot") : null}
            confronto={r("ordinatoAP") ? { valore: tot("ordinatoAP"), etichetta: `vs ${anno - 1}` } : null}
          />
          <KpiEroe
            scuro
            etichetta="Budget a oggi"
            valore={r("budgetAdOggi") ? tot("budgetAdOggi") : null}
            confronto={
              tot("budgetAdOggi") > 0
                ? { valore: tot("budgetAdOggi"), etichetta: "" }
                : null
            }
            nota={
              !r("budgetAdOggi")
                ? "calcolo in corso"
                : tot("budgetAdOggi") > 0
                ? `Raggiungimento ${((tot("ordinatoTot") / tot("budgetAdOggi")) * 100).toFixed(0)}% · anno ${euro(tot("budgetAnno"))}`
                : "non configurato"
            }
          />
          <KpiEroe
            scuro
            etichetta={ytd ? `Fatturato ${anno} a oggi` : `Fatturato ${anno}`}
            valore={r("fatturatoTot") ? tot("fatturatoTot") : null}
            confronto={r("fatturatoAP") ? { valore: tot("fatturatoAP"), etichetta: `vs ${anno - 1}` } : null}
          />
          <KpiEroe
            scuro
            etichetta="Portafoglio da consegnare"
            valore={r("portafoglioTot") ? tot("portafoglioTot") : null}
            nota="ordini acquisiti ancora da evadere"
          />
          <KpiEroe
            scuro
            etichetta="Ordini"
            valore={r("nOrdini") ? tot("nOrdini") : null}
            unita="numero"
            nota={r("ordineMedio") ? `Ordine medio ${euro(tot("ordineMedio"))}` : "calcolo in corso"}
          />
          <KpiEroe
            scuro
            etichetta="BEP a oggi"
            valore={r("bepAdOggi") ? tot("bepAdOggi") : null}
            nota={
              !r("bepAdOggi")
                ? "calcolo in corso"
                : tot("bepAdOggi") > 0
                ? tot("ordinatoTot") >= tot("bepAdOggi")
                  ? "sopra il pareggio"
                  : "sotto il pareggio"
                : "non configurato"
            }
          />
        </motion.div>

        <p className="text-xs text-text-muted mb-4">
          Dati aggiornati al <strong>{dataMassima ?? "n/d"}</strong>
          {runRicevutoIl && <> · caricamento del {new Date(runRicevutoIl).toLocaleString("it-IT")}</>}
          {" · "}budget confrontato a pari periodo.{" "}
          {ytd ? (
            <>
              Confronto anno su anno fermato al{" "}
              <strong>
                {limiteYtd.slice(8, 10)}/{limiteYtd.slice(5, 7)}
              </strong>{" "}
              per entrambi gli anni.
            </>
          ) : (
            <span className="text-warning">
              Confronto su anno intero: se il {anno} è in corso, il delta contro il {anno - 1}{" "}
              è falsato dai mesi che mancano.
            </span>
          )}
        </p>

        {/* ── SINTESI ────────────────────────────────────────────────────── */}
        {vista === "sintesi" && (
          <div className={`grid grid-cols-1 lg:grid-cols-3 ${imp.densita === "compatta" ? "gap-2" : "gap-4"}`}>
            <Scheda
              titolo="Raggiungimento per business unit"
              sottotitolo="consuntivo contro budget e BEP, allo stesso giorno dell'anno"
            >
              <Bullet righe={righeBullet} onClick={(b) => alternaFiltro("bu", b)} />
            </Scheda>

            <Scheda
              titolo="Ordinato, budget e BEP per mese"
              className="lg:col-span-2"
              sottotitolo="il budget segue i giorni lavorativi: agosto è più basso perché è chiuso"
            >
              <GraficoCombo
                barre={{ nome: "Ordinato", risultato: r("ordinatoMese") }}
                linee={[
                  { nome: "Budget", risultato: r("budgetMese"), colore: "#f59e0b" },
                  { nome: "BEP", risultato: r("bepMese"), colore: "#ef4444", tratteggiata: true },
                ]}
              />
            </Scheda>

            <Scheda titolo="Visione progressiva annua" className="lg:col-span-2">
              <GraficoLinee
                serie={[
                  { nome: "Ordinato", risultato: r("ordinatoProgSett"), colore: "#00a1be" },
                  { nome: "Budget", risultato: r("budgetProgSett"), colore: "#f59e0b", tratteggiata: true },
                  { nome: "BEP", risultato: r("bepProgSett"), colore: "#ef4444", tratteggiata: true },
                ]}
                altezza={300}
              />
            </Scheda>

            <Scheda titolo="Quota per business unit">
              <GraficoTorta
                risultato={r("ordinatoBu")}
                onClick={(b) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda
              titolo="Andamento per business unit"
              className="lg:col-span-3"
              sottotitolo="stessa scala per tutti, altrimenti il confronto visivo mente"
            >
              <Multipli serie={multipliBu} onClick={(b) => alternaFiltro("bu", b)} />
            </Scheda>
          </div>
        )}

        {/* ── SCOSTAMENTI ────────────────────────────────────────────────── */}
        {vista === "scostamenti" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Scheda
              titolo={`Da dove viene la variazione ${anno - 1} → ${anno}`}
              sottotitolo="contributo di ogni business unit"
            >
              <Waterfall
                partenza={tot("ordinatoAP")}
                arrivo={tot("ordinatoTot")}
                voci={vociWaterfall(r("ordinatoBu"), r("ordinatoBuAP"))}
                etichettaPartenza={String(anno - 1)}
                etichettaArrivo={String(anno)}
                onClickVoce={(b) => alternaFiltro("bu", b)}
              />
            </Scheda>

            <Scheda
              titolo={`Contributo per agente ${anno - 1} → ${anno}`}
              sottotitolo="stessa variazione, letta per commerciale"
            >
              <Waterfall
                partenza={tot("ordinatoAP")}
                arrivo={tot("ordinatoTot")}
                voci={vociWaterfall(r("ordinatoAgente"), r("ordinatoAgenteAP"))}
                etichettaPartenza={String(anno - 1)}
                etichettaArrivo={String(anno)}
                onClickVoce={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            <Scheda titolo="Scostamento dal budget per business unit" sottotitolo="a pari periodo">
              <BarreScostamento
                dati={(r("ordinatoBu")?.righe ?? []).map((x) => {
                  const b =
                    r("budgetBuAdOggi")?.righe.find((y) => y.etichetta === x.etichetta)?.valore ?? 0;
                  return { etichetta: x.etichetta, valore: x.valore - b };
                })}
                onClick={(b) => alternaFiltro("bu", b)}
              />
            </Scheda>

            <Scheda titolo="Scostamento dal budget per agente" sottotitolo="a pari periodo">
              <BarreScostamento
                dati={(r("ordinatoAgente")?.righe ?? []).map((x) => {
                  const b =
                    r("budgetAgenteAdOggi")?.righe.find((y) => y.etichetta === x.etichetta)
                      ?.valore ?? 0;
                  return { etichetta: x.etichetta, valore: x.valore - b };
                })}
                onClick={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            {heatmapScostamenti && (
              <Scheda
                titolo="Dove e quando"
                className="lg:col-span-2"
                sottotitolo={
                  heatmapScostamenti.conBudget
                    ? "scostamento % dal budget, business unit per mese — verde sopra, rosso sotto"
                    : "budget non disponibile: importa il file per vedere gli scostamenti"
                }
              >
                <Heatmap
                  righe={heatmapScostamenti.righe}
                  colonne={heatmapScostamenti.colonne}
                  valori={heatmapScostamenti.valori}
                  formato="percentuale"
                  divergente
                  onClick={(bu) => alternaFiltro("bu", bu)}
                />
              </Scheda>
            )}

            <Scheda titolo="Business unit — quadro completo" className="lg:col-span-2">
              <TabellaAnalitica
                colonnaDimensione="Business unit"
                colonne={colonneConfronto({ annoCorrente: anno, conBudget: true })}
                righe={tabellaDi("ordinatoBu", "ordinatoBuAP", "budgetBuAdOggi", null, "bu").righe}
                onClickRiga={(b) => alternaFiltro("bu", b)}
                rigaEvidenziata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda titolo="Agenti — quadro completo" className="lg:col-span-2">
              <TabellaAnalitica
                colonnaDimensione="Agente"
                colonne={colonneConfronto({ annoCorrente: anno, conBudget: true })}
                righe={
                  tabellaDi("ordinatoAgente", "ordinatoAgenteAP", "budgetAgenteAdOggi", null, "agente")
                    .righe
                }
                onClickRiga={(a) => alternaFiltro("agente", a)}
                rigaEvidenziata={filtroDi("agente")}
              />
            </Scheda>
          </div>
        )}

        {/* ── CLIENTI ────────────────────────────────────────────────────── */}
        {vista === "clienti" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Scheda
              titolo="Concentrazione del fatturato"
              sottotitolo="barre = valore, linea = cumulata sul totale"
            >
              <Pareto
                dati={(r("clienti")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                onClick={(c) => alternaFiltro("cliente", c)}
              />
            </Scheda>

            <Scheda
              titolo="Chi si sta muovendo"
              sottotitolo="dimensione = ordinato dell'anno · solo clienti sopra 5.000 € l'anno prima"
            >
              <Quadranti
                punti={puntiQuadranti}
                etichettaX={`Ordinato ${anno - 1}`}
                etichettaY="Variazione %"
                onClick={(c) => alternaFiltro("cliente", c)}
              />
            </Scheda>

            <Scheda titolo="Ordinato per agente">
              <BarreScostamento
                dati={(r("ordinatoAgente")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                onClick={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            <Scheda titolo="Quota per business unit">
              <GraficoTorta
                risultato={r("ordinatoBu")}
                onClick={(b) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda
              titolo="Clienti — quadro completo"
              className="lg:col-span-2"
              sottotitolo="ordinabile per qualsiasi colonna; l’andamento è la tendenza dei mesi, verde se sale — il mese in corso, ancora incompleto, non conta"
            >
              <TabellaAnalitica
                colonnaDimensione="Cliente"
                colonne={colonneConfronto({ annoCorrente: anno, conSparkline: true })}
                righe={tabellaDi("clienti", "clientiAP", null, "clientiMese", "cliente").righe}
                massimoIniziale={15}
                ultimoPeriodoParziale
                onClickRiga={(c) => alternaFiltro("cliente", c)}
                rigaEvidenziata={filtroDi("cliente")}
              />
            </Scheda>
          </div>
        )}

        {/* ── PREVENTIVI ─────────────────────────────────────────────────── */}
        {vista === "preventivi" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Scheda titolo="Preventivi aperti" sottotitolo="importo inevaso, tutti gli anni">
              <div className="grid grid-cols-2 gap-4 py-2">
                <KpiEroe etichetta="Importo inevaso" valore={tot("preventiviTot")} />
                <KpiEroe
                  etichetta="Preventivi distinti"
                  valore={tot("nPreventivi")}
                  unita="numero"
                />
              </div>
              <div className="mt-3">
                <GraficoTorta
                  risultato={r("preventiviBu")}
                  altezza={220}
                  onClick={(b) => alternaFiltro("bu", b)}
                  selezionata={filtroDi("bu")}
                />
              </div>
            </Scheda>

            <Scheda titolo="Concentrazione per cliente">
              <Pareto
                dati={(r("preventiviCliente")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                massimo={15}
                onClick={(c) => alternaFiltro("cliente", c)}
              />
            </Scheda>

            <Scheda titolo="Inevaso per agente">
              <BarreScostamento
                dati={(r("preventiviAgente")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                onClick={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            <Scheda titolo="Portafoglio per mese di consegna">
              <GraficoCombo
                barre={{ nome: "Portafoglio", risultato: r("portafoglioMese"), colore: "#8b5cf6" }}
                linee={[]}
                altezza={280}
              />
            </Scheda>

            <Scheda titolo="Per causale magazzino" className="lg:col-span-2">
              <BarreScostamento
                dati={(r("preventiviCausale")?.righe ?? []).slice(0, 12).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                altezza={320}
                onClick={(c) => alternaFiltro("causale", c)}
              />
            </Scheda>
          </div>
        )}

        {/* ── CONVERSIONE ────────────────────────────────────────────────── */}
        {vista === "conversione" && (
          <VistaConversione
            anno={anno}
            periodo={periodo}
            filtriSpec={filtriSpec}
            alternaFiltro={alternaFiltro}
            filtroDi={filtroDi}
          />
        )}

        {/* ── BACK OFFICE ────────────────────────────────────────────────── */}
        {vista === "backoffice" && (
          <VistaBackoffice
            anno={anno}
            periodo={periodo}
            filtriSpec={filtriSpec}
            alternaFiltro={alternaFiltro}
            filtroDi={filtroDi}
          />
        )}
      </div>
    </div>
  );
}
