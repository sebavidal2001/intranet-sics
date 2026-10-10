"use client";

/**
 * I POZZETTI — Asse, Legenda, Valori, Filtri; e, nelle tabelle, Campi, Valori, Filtri.
 *
 * Per chi viene da Power BI: si prende un campo dall'albero e lo si lascia dove
 * serve, e il riquadro si ricalcola subito. Non e' un modello nuovo: e' una
 * vista della stessa selezione dell'albero (vedi `pozzetti-regole.ts`), quindi
 * spuntare una casella e trascinare nel pozzetto danno lo stesso risultato.
 *
 * Il trascinamento da solo non basta mai: su tablet non esiste, e per chi naviga
 * da tastiera non c'e'. Ogni pozzetto ha quindi anche un menu «Aggiungi un
 * campo…» con le sole voci che accetterebbe, e ogni voce ha il suo pulsante per
 * toglierla. Un gesto rifiutato dice sempre perche'.
 *
 * In una **tabella** non c'e' un asse ne' una legenda: ogni campo e' una
 * colonna e ne servono quanti se ne vuole, quindi al loro posto c'e' un solo
 * pozzetto «Campi» senza limite di due.
 *
 * Ogni **valore** ha un menu (la freccia accanto al nome) con due scelte che in
 * Power BI si fanno sul campo: *come* si calcola (somma degli importi, numero
 * di documenti, valore medio) e a *quale periodo* si riferisce (quello scelto,
 * l'anno precedente, il progressivo). Cosi' «ordinato di quest'anno» e
 * «ordinato dell'anno scorso» sono due colonne della stessa tabella.
 *
 * Non c'e' disegno libero ne' messa a punto fine del grafico: quelli restano a
 * Power BI Desktop (e al pannello Aspetto per le scelte di resa).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Tag, X } from "lucide-react";
import {
  famiglieDelleMisure,
  nomeConPeriodo,
  type SelezioneCampi,
  type VocabolarioAlbero,
} from "@/components/prototipo-bi/albero-campi";
import {
  TIPO_MIME_CAMPO,
  aggiungiPeriodoAlValore,
  cambiaCalcoloValore,
  cambiaPeriodoValore,
  contenutoPozzetti,
  contenutoTabella,
  deponi,
  iscriviTrascinamento,
  leggiTrascinamento,
  leggiVoceDalTrasferimento,
  motivoPeriodoNonAmmesso,
  spostaCampo,
  spostaValore,
  togliVoce,
  vociDisponibili,
  type ContestoPozzetti,
  type EsitoDeposito,
  type NomePozzetto,
  type VoceCampo,
} from "@/components/prototipo-bi/pozzetti-regole";
import {
  GRUPPI_MISURE,
  GRUPPI_OPERAZIONI,
  NATURE,
  alternativeDiCalcolo,
  eDocumento,
  etichettaDocumento,
  naturaDellaVoce,
} from "@/lib/prototipo-bi/albero-modello";
import { VOCI_CALENDARIO } from "@/lib/prototipo-bi/gruppi-campi";
import {
  NOMI_VARIANTE,
  NOMI_VARIANTE_BREVI,
  scomponiValore,
  type ChiaveCampo,
  type ChiaveValore,
  type VarianteValore,
} from "@/lib/prototipo-bi/misure-vocabolario";
import type { Dimensione, Filtro } from "@/lib/prototipo-bi/tipi";

interface Messaggio {
  tipo: "avviso" | "rifiuto";
  testo: string;
}

const TITOLI: Record<NomePozzetto, { titolo: string; descrizione: string; vuoto: string }> = {
  asse: {
    titolo: "Asse",
    descrizione: "Le categorie, o il tempo",
    vuoto: "Trascina qui una dimensione o il tempo",
  },
  legenda: {
    titolo: "Legenda",
    descrizione: "Come suddividere ogni categoria",
    vuoto: "Trascina qui una seconda dimensione",
  },
  campi: {
    titolo: "Campi",
    descrizione: "Una colonna per ogni campo: cliente, articolo, mese…",
    vuoto: "Trascina qui quanti campi vuoi",
  },
  valori: {
    titolo: "Valori",
    descrizione: "Quello che si misura",
    vuoto: "Trascina qui una misura",
  },
  filtri: {
    titolo: "Filtri",
    descrizione: "Quali righe tenere",
    vuoto: "Trascina qui una dimensione da filtrare",
  },
};

function ruoloDelValore(valore: ChiaveValore, indice: number): string {
  if (indice === 0) return "principale";
  const { chiave } = scomponiValore(valore);
  if (chiave === "budget") return "obiettivo";
  if (chiave === "bep") return "soglia";
  return "confronto";
}

function riassuntoFiltro(f: Filtro): string {
  const valori = Array.isArray(f.valore) ? f.valore.map(String) : [String(f.valore)];
  const pieni = valori.filter((v) => v.trim() !== "");
  if (pieni.length === 0) return "da scegliere";
  const elenco = pieni.length <= 2 ? pieni.join(", ") : `${pieni.length} valori`;
  if (f.op === "neq") return `diverso da ${elenco}`;
  if (f.op === "contiene") return `contiene ${elenco}`;
  return elenco;
}

function Chip({
  etichetta,
  nota,
  segno,
  menu,
  togli,
  sposta,
  compatto = false,
}: {
  etichetta: string;
  nota?: string;
  /** Il segno che dice che specie di campo e': somma, conteggio, campo per suddividere. */
  segno?: ReactNode;
  /** Il menu del valore (calcolo e periodo), accanto al nome. */
  menu?: ReactNode;
  togli: { nome: string; onClick: () => void };
  sposta?: { prima?: () => void; dopo?: () => void };
  compatto?: boolean;
}) {
  return (
    <li
      className={`relative flex max-w-full items-center gap-0.5 rounded-md border border-border bg-bg-page ${
        compatto ? "min-h-6 py-0 pl-1.5 pr-0.5 text-xs" : "min-h-9 gap-1 rounded-lg py-1 pl-2 pr-1 text-sm"
      }`}
    >
      {sposta?.prima && (
        <button
          type="button"
          onClick={sposta.prima}
          aria-label={`Sposta «${etichetta}» prima`}
          className="rounded p-1 text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {segno}
      <span className="min-w-0 truncate">
        {etichetta}
        {nota && <span className="ml-1 text-xs text-text-muted">· {nota}</span>}
      </span>
      {menu}
      {sposta?.dopo && (
        <button
          type="button"
          onClick={sposta.dopo}
          aria-label={`Sposta «${etichetta}» dopo`}
          className="rounded p-1 text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={togli.onClick}
        aria-label={togli.nome}
        className="rounded p-1 text-text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}

/** Il segno di un campo per suddividere (o del tempo): sta davanti al nome, nei pozzetti. */
function SegnoCampo({ tempo = false }: { tempo?: boolean }) {
  const Icona = tempo ? CalendarDays : Tag;
  return <Icona className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />;
}

/** Il segno di un valore: la sua natura (somma, conteggio, media, percentuale). */
function SegnoValore({ simbolo, titolo }: { simbolo: string; titolo: string }) {
  return (
    <span
      aria-hidden
      title={titolo}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-bg px-1 text-[10px] font-semibold text-text-muted"
    >
      {simbolo}
    </span>
  );
}

const PERIODI: Array<{ variante: VarianteValore | undefined; nome: string }> = [
  { variante: undefined, nome: NOMI_VARIANTE.corrente },
  { variante: "anno_precedente", nome: NOMI_VARIANTE.anno_precedente },
  { variante: "progressivo", nome: NOMI_VARIANTE.progressivo },
  { variante: "progressivo_ap", nome: NOMI_VARIANTE.progressivo_ap },
];

/**
 * Il menu di un valore: come si calcola e a quale periodo si riferisce.
 *
 * Un pannello che si apre sotto il valore. Si chiude con Esc, con un clic
 * fuori, o scegliendo: ogni scelta e' un gesto solo, senza «Applica».
 */
function MenuValore({
  valore,
  indice,
  nome,
  selezione,
  contesto,
  compatto,
  onEsito,
}: {
  valore: ChiaveValore;
  indice: number;
  nome: string;
  selezione: SelezioneCampi;
  contesto: ContestoPozzetti;
  compatto: boolean;
  onEsito: (esito: EsitoDeposito) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const radice = useRef<HTMLDivElement>(null);
  const { chiave, variante } = scomponiValore(valore);
  const alternative = alternativeDiCalcolo(chiave);
  const idPannello = `menu-valore-${indice}`;

  useEffect(() => {
    if (!aperto) return;
    function suClic(evento: MouseEvent) {
      if (radice.current && !radice.current.contains(evento.target as Node)) setAperto(false);
    }
    function suTasto(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAperto(false);
    }
    document.addEventListener("mousedown", suClic);
    document.addEventListener("keydown", suTasto);
    return () => {
      document.removeEventListener("mousedown", suClic);
      document.removeEventListener("keydown", suTasto);
    };
  }, [aperto]);

  return (
    <div ref={radice} className="relative">
      <button
        type="button"
        aria-label={`Calcolo e periodo di ${nome}`}
        aria-expanded={aperto}
        aria-controls={aperto ? idPannello : undefined}
        onClick={() => setAperto((prima) => !prima)}
        className={`rounded p-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          aperto || variante ? "text-primary" : "text-text-muted"
        }`}
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {aperto && (
        <div
          id={idPannello}
          role="group"
          aria-label={`Calcolo e periodo di ${nome}`}
          className={`absolute left-0 top-full z-30 mt-1 space-y-2 rounded-lg border border-border bg-bg p-2 shadow-lg ${
            compatto ? "w-60" : "w-72"
          }`}
        >
          {alternative.length > 1 && (
            <fieldset>
              <legend className="mb-1 font-tenorite text-[10px] font-bold uppercase tracking-wide text-text-muted">
                Calcola come
              </legend>
              <div className="space-y-0.5">
                {alternative.map((alternativa) => (
                  <button
                    key={alternativa.chiave}
                    type="button"
                    aria-pressed={alternativa.chiave === chiave}
                    onClick={() => {
                      onEsito(cambiaCalcoloValore(selezione, indice, alternativa.chiave, contesto));
                      setAperto(false);
                    }}
                    className={`flex min-h-7 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      alternativa.chiave === chiave ? "bg-primary/10 font-semibold text-primary" : ""
                    }`}
                  >
                    <SegnoValore
                      simbolo={NATURE[naturaDellaVoce(alternativa.chiave)].simbolo}
                      titolo={NATURE[naturaDellaVoce(alternativa.chiave)].nome}
                    />
                    {alternativa.nome}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-1 font-tenorite text-[10px] font-bold uppercase tracking-wide text-text-muted">
              Periodo
            </legend>
            <div className="space-y-0.5">
              {PERIODI.map((periodo) => {
                const motivo = motivoPeriodoNonAmmesso(chiave, periodo.variante, contesto.definizioni);
                return (
                  <button
                    key={periodo.variante ?? "corrente"}
                    type="button"
                    disabled={motivo !== null}
                    title={motivo ?? undefined}
                    aria-pressed={periodo.variante === variante}
                    onClick={() => {
                      onEsito(cambiaPeriodoValore(selezione, indice, periodo.variante, contesto));
                      setAperto(false);
                    }}
                    className={`flex min-h-7 w-full items-center rounded px-2 text-left text-xs hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                      periodo.variante === variante ? "bg-primary/10 font-semibold text-primary" : ""
                    }`}
                  >
                    {periodo.nome}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-text-muted">
              «Periodo scelto» è quello della dashboard o del riquadro. L’anno precedente è lo stesso periodo un anno prima.
            </p>
          </fieldset>

          <button
            type="button"
            onClick={() => {
              const altro: VarianteValore = variante === "anno_precedente" ? "progressivo" : "anno_precedente";
              onEsito(
                aggiungiPeriodoAlValore(
                  selezione,
                  indice,
                  variante === undefined ? "anno_precedente" : altro,
                  contesto
                )
              );
              setAperto(false);
            }}
            className="w-full rounded-md border border-primary px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {variante === undefined
              ? "+ Aggiungi anche l’anno precedente"
              : "+ Aggiungi anche un altro periodo"}
          </button>
        </div>
      )}
    </div>
  );
}

function Pozzetto({
  nome,
  idoneo,
  onRilascia,
  menu,
  children,
  vuoto,
  compatto,
  largo = false,
}: {
  nome: NomePozzetto;
  /** Se, mentre si trascina qualcosa, questo pozzetto lo accetterebbe (null = niente in corso). */
  idoneo: boolean | null;
  onRilascia: (voce: VoceCampo) => void;
  menu: ReactNode;
  children: ReactNode;
  vuoto: boolean;
  compatto: boolean;
  /** Occupa tutta la riga della griglia. */
  largo?: boolean;
}) {
  const testi = TITOLI[nome];
  const stato =
    idoneo === true
      ? "border-primary bg-primary/5"
      : idoneo === false
        ? "border-dashed border-border opacity-70"
        : "border-border";
  return (
    <section
      aria-label={testi.titolo}
      onDragOver={(evento) => {
        // Sempre accettato: il rifiuto si spiega al rilascio, non con un cursore
        // «vietato» che non dice perche'.
        evento.preventDefault();
        evento.dataTransfer.dropEffect = "move";
      }}
      onDrop={(evento) => {
        evento.preventDefault();
        const voce =
          leggiVoceDalTrasferimento(evento.dataTransfer.getData(TIPO_MIME_CAMPO)) ?? leggiTrascinamento();
        if (voce) onRilascia(voce);
      }}
      className={`rounded-lg border bg-bg transition-colors ${compatto ? "p-2" : "rounded-xl p-3"} ${stato} ${
        largo ? "col-span-full" : ""
      }`}
    >
      {compatto ? (
        <>
          {/* Titolo e menu «+» sulla stessa riga: il pozzetto resta basso. */}
          <header className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="font-tenorite text-[11px] font-bold uppercase tracking-wide" title={testi.descrizione}>
              {testi.titolo}
            </h3>
            <div className="w-24 shrink-0">{menu}</div>
          </header>
          {vuoto ? (
            <p className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-text-muted">Trascina qui</p>
          ) : (
            <ul className="flex flex-wrap gap-1">{children}</ul>
          )}
        </>
      ) : (
        <>
          <header className="mb-2">
            <h3 className="font-tenorite text-sm font-bold uppercase tracking-wide">{testi.titolo}</h3>
            <p className="text-xs text-text-muted">{testi.descrizione}</p>
          </header>
          {vuoto ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-text-muted">{testi.vuoto}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">{children}</ul>
          )}
          <div className="mt-2">{menu}</div>
        </>
      )}
    </section>
  );
}

/** Cio' che il resto della pagina puo' chiedere ai pozzetti: per esempio la tela, quando ci si lascia un campo. */
export interface ManigliaPozzetti {
  deponi: (pozzetto: NomePozzetto, voce: VoceCampo) => void;
}

interface ProprietaPozzetti {
  vocabolario: VocabolarioAlbero;
  selezione: SelezioneCampi;
  /** I filtri della spec: non fanno parte della selezione, li gestisce chi usa il componente. */
  filtri: Filtro[];
  onCambia: (selezione: SelezioneCampi) => void;
  /** Aggiunge un filtro (senza valori) su questa dimensione. */
  onAggiungiFiltro: (dimensione: Dimensione) => void;
  onTogliFiltro: (indice: number) => void;
  /** Nel pannello laterale: una colonna sola, come in Power BI. */
  compatto?: boolean;
  /** In una tabella: Campi (senza limite), Valori, Filtri. Nei grafici: Asse, Legenda, Valori, Filtri. */
  modalita?: "grafico" | "tabella";
  /** Porta a dove si scelgono i valori dei filtri (un'altra scheda del pannello). */
  onVaiAiFiltri?: () => void;
  /** Ogni volta che un gesto produce un avviso o un rifiuto (null = nessuno): per mostrarlo dove si sta guardando. */
  onMessaggio?: (messaggio: { tipo: "avviso" | "rifiuto"; testo: string } | null) => void;
}

export const Pozzetti = forwardRef<ManigliaPozzetti, ProprietaPozzetti>(function Pozzetti(
  {
    vocabolario,
    selezione,
    filtri,
    onCambia,
    onAggiungiFiltro,
    onTogliFiltro,
    compatto = false,
    modalita = "grafico",
    onVaiAiFiltri,
    onMessaggio,
  },
  ref
) {
  const inTabella = modalita === "tabella";
  const [messaggio, setMessaggio] = useState<Messaggio | null>(null);
  useEffect(() => {
    if (messaggio) onMessaggio?.(messaggio);
    // La notifica parte solo quando il messaggio cambia, non a ogni render del genitore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messaggio]);
  const inTrascinamento = useSyncExternalStore(iscriviTrascinamento, leggiTrascinamento, () => null);

  const etichettaDimensione = (chiave: Dimensione) =>
    vocabolario.dimensioni.find((d) => d.chiave === chiave)?.etichetta ?? chiave;
  // Il numero del documento ha il nome della sua operazione («Numero ordine»),
  // se i valori scelti sono di una sola.
  const famiglieScelte = famiglieDelleMisure(selezione.misure, vocabolario.famiglie);
  const nomeCampo = (chiave: Dimensione) =>
    (eDocumento(chiave) && famiglieScelte.length === 1
      ? (() => {
          const proprio = etichettaDocumento(famiglieScelte[0]);
          return chiave === "documento_anno" ? proprio : proprio?.replace(/\/anno$/, "");
        })()
      : undefined) ??
    etichettaDimensione(chiave);

  const contesto = useMemo<ContestoPozzetti>(
    () => ({
      perMetrica: vocabolario.dimensioniPerMetrica,
      famiglie: vocabolario.famiglie,
      definizioni: vocabolario.definizioni,
      etichetta: (voce) => {
        if (voce.tipo === "misura") {
          const { chiave } = scomponiValore(voce.chiave);
          const nome = vocabolario.metriche.find((m) => m.chiave === chiave)?.etichetta ?? chiave;
          return nomeConPeriodo(nome, voce.chiave);
        }
        if (voce.tipo === "dimensione") return nomeCampo(voce.chiave);
        return VOCI_CALENDARIO.find((c) => c.chiave === voce.chiave)?.etichetta ?? voce.chiave;
      },
    }),
    // etichettaDimensione dipende solo da vocabolario.dimensioni; il nome del
    // numero del documento dalle operazioni dei valori scelti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vocabolario.dimensioniPerMetrica, vocabolario.famiglie, vocabolario.definizioni, vocabolario.metriche, vocabolario.dimensioni, famiglieScelte.join("|")]
  );

  const campi = useMemo(
    () => ({
      misure: vocabolario.tipologie.flatMap((t) => t.metriche),
      dimensioni: vocabolario.dimensioni.map((d) => d.chiave),
    }),
    [vocabolario.tipologie, vocabolario.dimensioni]
  );

  const contenuto = contenutoPozzetti(selezione);
  const colonne = contenutoTabella(selezione);

  /** Il risultato di un gesto: applica la selezione nuova e scrive l'esito dove si guarda. */
  function applicaEsito(esito: EsitoDeposito) {
    if (!esito.ok) {
      setMessaggio({ tipo: "rifiuto", testo: esito.motivo });
      return;
    }
    if (esito.selezione !== selezione) onCambia(esito.selezione);
    setMessaggio(esito.avviso ? { tipo: "avviso", testo: esito.avviso } : null);
  }

  function deponiVoce(pozzetto: NomePozzetto, voce: VoceCampo) {
    const esito = deponi(selezione, pozzetto, voce, contesto);
    if (!esito.ok) {
      setMessaggio({ tipo: "rifiuto", testo: esito.motivo });
      return;
    }
    if (esito.aggiungiFiltroSu) {
      const dimensione = esito.aggiungiFiltroSu;
      const famiglia = (d: Dimensione) => (d === "bu_categoria" ? "bu" : d);
      if (filtri.some((f) => famiglia(f.campo) === famiglia(dimensione))) {
        setMessaggio({
          tipo: "rifiuto",
          testo: `C'è già un filtro su ${etichettaDimensione(dimensione)}: cambialo nel riquadro «Solo dove».`,
        });
        return;
      }
      onAggiungiFiltro(dimensione);
      setMessaggio({
        tipo: "avviso",
        testo: `Filtro su ${etichettaDimensione(dimensione)} aggiunto: scegli i valori nel riquadro «Solo dove».`,
      });
      return;
    }
    if (esito.selezione !== selezione) onCambia(esito.selezione);
    setMessaggio(esito.avviso ? { tipo: "avviso", testo: esito.avviso } : null);
  }

  function togliDa(voce: VoceCampo) {
    const esito = togliVoce(selezione, voce, contesto, inTabella);
    if (!esito.ok) {
      setMessaggio({ tipo: "rifiuto", testo: esito.motivo });
      return;
    }
    onCambia(esito.selezione);
    setMessaggio(esito.avviso ? { tipo: "avviso", testo: esito.avviso } : null);
  }

  const idoneo = (pozzetto: NomePozzetto): boolean | null =>
    inTrascinamento ? deponi(selezione, pozzetto, inTrascinamento, contesto).ok : null;

  // Una funzione e non un componente: dichiarato dentro il render, un componente
  // si rimonterebbe a ogni scelta e il menu perderebbe il fuoco.
  function menu(pozzetto: NomePozzetto) {
    const disponibili = vociDisponibili(pozzetto, selezione, contesto, campi);
    const nome = TITOLI[pozzetto].titolo;
    const valore = (v: VoceCampo) => `${v.tipo}:${v.chiave}`;
    const eDisponibile = (v: VoceCampo) => disponibili.some((d) => d.tipo === v.tipo && d.chiave === v.chiave);
    const personalizzate = vocabolario.tipologie.find((t) => t.chiave === "misure")?.metriche ?? [];
    const gruppi: Array<{ etichetta: string; voci: VoceCampo[] }> =
      pozzetto === "valori"
        ? [
            ...GRUPPI_OPERAZIONI.map((g) => ({ etichetta: g.etichetta, chiavi: g.valori as ChiaveCampo[] })),
            ...GRUPPI_MISURE.map((g) => ({
              etichetta: `Misure · ${g.etichetta}`,
              chiavi: g.misure.map((m) => m.chiave) as ChiaveCampo[],
            })),
            { etichetta: "Misure personalizzate", chiavi: personalizzate },
          ]
            .map((g) => ({
              etichetta: g.etichetta,
              voci: g.chiavi.map((chiave): VoceCampo => ({ tipo: "misura", chiave })).filter(eDisponibile),
            }))
            .filter((g) => g.voci.length > 0)
        : [
            { etichetta: "Tempo", voci: disponibili.filter((v) => v.tipo === "calendario") },
            { etichetta: "Dimensioni", voci: disponibili.filter((v) => v.tipo === "dimensione") },
          ].filter((g) => g.voci.length > 0);
    return (
      <select
        aria-label={`Aggiungi a ${nome}`}
        value=""
        disabled={disponibili.length === 0}
        onChange={(evento) => {
          const scelta = disponibili.find((v) => valore(v) === evento.target.value);
          if (scelta) deponiVoce(pozzetto, scelta);
        }}
        className={`${compatto ? "h-6" : "h-9"} w-full rounded-md border border-border bg-bg-page px-1.5 text-xs text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <option value="">
          {disponibili.length === 0 ? (compatto ? "—" : "Niente da aggiungere") : compatto ? "+ Aggiungi" : "Aggiungi un campo…"}
        </option>
        {gruppi.map((g) => (
          <optgroup key={g.etichetta} label={g.etichetta}>
            {g.voci.map((v) => (
              <option key={valore(v)} value={valore(v)}>
                {contesto.etichetta(v)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }

  useImperativeHandle(ref, () => ({ deponi: deponiVoce }));

  const haFiltriDaCompletare = filtri.some((f) => riassuntoFiltro(f) === "da scegliere");
  const valori = inTabella ? colonne.valori : contenuto.valori;

  /** I chip dei valori: gli stessi in un grafico e in una tabella. */
  const chipValori = valori.map((valoreScelto, indice) => {
    const voce: VoceCampo = { tipo: "misura", chiave: valoreScelto };
    const nome = contesto.etichetta(voce);
    const { chiave, variante } = scomponiValore(valoreScelto);
    const natura = NATURE[naturaDellaVoce(chiave, vocabolario.definizioni)];
    // Il periodo, se non e' quello scelto, sta dopo il nome in forma breve: due
    // chip «Ordinato» uguali non si distinguerebbero, ma il nome intero non ci sta.
    const periodo = variante ? NOMI_VARIANTE_BREVI[variante] : "";
    const ruolo = compatto || inTabella ? "" : ruoloDelValore(valoreScelto, indice);
    return (
      <Chip
        compatto={compatto}
        key={valoreScelto}
        etichetta={contesto.etichetta({ tipo: "misura", chiave })}
        nota={[periodo, ruolo].filter(Boolean).join(" · ") || undefined}
        segno={<SegnoValore simbolo={natura.simbolo} titolo={`${natura.nome}: ${natura.spiegazione}`} />}
        menu={
          <MenuValore
            valore={valoreScelto}
            indice={indice}
            nome={nome}
            selezione={selezione}
            contesto={contesto}
            compatto={compatto}
            onEsito={applicaEsito}
          />
        }
        togli={{ nome: `Togli ${nome} dai valori`, onClick: () => togliDa(voce) }}
        sposta={{
          prima: indice > 0 ? () => onCambia(spostaValore(selezione, indice, indice - 1)) : undefined,
          dopo: indice < valori.length - 1 ? () => onCambia(spostaValore(selezione, indice, indice + 1)) : undefined,
        }}
      />
    );
  });

  return (
    <section aria-labelledby="titolo-pozzetti" className={compatto ? undefined : "mt-4"}>
      <div className={compatto ? "sr-only" : "mb-2"}>
        <h3 id="titolo-pozzetti" className="font-tenorite text-sm font-bold uppercase tracking-wide">
          Pozzetti
        </h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Trascina un campo dall’albero nel pozzetto, oppure sceglilo dal menu del pozzetto. Il riquadro si ricalcola subito.
        </p>
      </div>

      <div className={compatto ? "grid grid-cols-2 gap-1.5" : "grid gap-3 sm:grid-cols-2"}>
        {inTabella ? (
          <Pozzetto
            nome="campi"
            idoneo={idoneo("campi")}
            onRilascia={(v) => deponiVoce("campi", v)}
            vuoto={colonne.campi.length === 0}
            menu={menu("campi")}
            compatto={compatto}
            largo
          >
            {colonne.campi.map((voce, posizione) => {
              const eTempo = voce.tipo === "calendario";
              // Le dimensioni si riordinano fra loro; il tempo sta sempre per primo.
              const indiceDim = eTempo ? -1 : posizione - (selezione.granularita ? 1 : 0);
              return (
                <Chip
                  compatto={compatto}
                  key={`${voce.tipo}:${voce.chiave}`}
                  etichetta={contesto.etichetta(voce)}
                  segno={<SegnoCampo tempo={eTempo} />}
                  togli={{ nome: `Togli ${contesto.etichetta(voce)} dalle colonne`, onClick: () => togliDa(voce) }}
                  sposta={
                    eTempo
                      ? undefined
                      : {
                          prima: indiceDim > 0 ? () => onCambia(spostaCampo(selezione, indiceDim, indiceDim - 1)) : undefined,
                          dopo:
                            indiceDim < selezione.suddivisioni.length - 1
                              ? () => onCambia(spostaCampo(selezione, indiceDim, indiceDim + 1))
                              : undefined,
                        }
                  }
                />
              );
            })}
          </Pozzetto>
        ) : (
          <>
            <Pozzetto nome="asse" idoneo={idoneo("asse")} onRilascia={(v) => deponiVoce("asse", v)} vuoto={!contenuto.asse} menu={menu("asse")} compatto={compatto}>
              {contenuto.asse && (
                <Chip
                  compatto={compatto}
                  etichetta={contesto.etichetta(contenuto.asse)}
                  nota={contenuto.asse.tipo === "calendario" && !compatto ? "tempo" : undefined}
                  togli={{ nome: `Togli ${contesto.etichetta(contenuto.asse)} dall'asse`, onClick: () => togliDa(contenuto.asse!) }}
                />
              )}
            </Pozzetto>

            <Pozzetto nome="legenda" idoneo={idoneo("legenda")} onRilascia={(v) => deponiVoce("legenda", v)} vuoto={contenuto.legenda.length === 0} menu={menu("legenda")} compatto={compatto}>
              {contenuto.legenda.map((voce) => (
                <Chip
                  compatto={compatto}
                  key={voce.chiave}
                  etichetta={contesto.etichetta(voce)}
                  togli={{ nome: `Togli ${contesto.etichetta(voce)} dalla legenda`, onClick: () => togliDa(voce) }}
                />
              ))}
            </Pozzetto>
          </>
        )}

        <Pozzetto nome="valori" idoneo={idoneo("valori")} onRilascia={(v) => deponiVoce("valori", v)} vuoto={valori.length === 0} menu={menu("valori")} compatto={compatto} largo={inTabella}>
          {chipValori}
        </Pozzetto>

        <Pozzetto nome="filtri" idoneo={idoneo("filtri")} onRilascia={(v) => deponiVoce("filtri", v)} vuoto={filtri.length === 0} menu={menu("filtri")} compatto={compatto} largo={inTabella}>
          {filtri.map((f, indice) => (
            <Chip
              compatto={compatto}
              key={`${f.campo}-${indice}`}
              etichetta={`${etichettaDimensione(f.campo === "bu_categoria" ? "bu" : f.campo)}: ${riassuntoFiltro(f)}`}
              togli={{ nome: `Togli il filtro su ${etichettaDimensione(f.campo === "bu_categoria" ? "bu" : f.campo)}`, onClick: () => onTogliFiltro(indice) }}
            />
          ))}
        </Pozzetto>
      </div>

      {haFiltriDaCompletare && (
        <p className="mt-1.5 text-xs text-text-muted">
          I valori dei filtri si scelgono nel riquadro «Solo dove».{" "}
          <button
            type="button"
            onClick={() => {
              if (onVaiAiFiltri) {
                onVaiAiFiltri();
                return;
              }
              document.getElementById("editor-filtri")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
            }}
            className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Vai ai filtri
          </button>
        </p>
      )}

      <p
        role="status"
        aria-live="polite"
        className={
          messaggio && !compatto
            ? `mt-2 rounded-lg border p-2 text-xs ${messaggio.tipo === "rifiuto" ? "border-warning/40 bg-warning/5" : "border-primary/40 bg-primary/5"}`
            : "sr-only"
        }
      >
        {messaggio?.testo ?? ""}
      </p>
    </section>
  );
});
