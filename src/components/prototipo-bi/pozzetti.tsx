"use client";

/**
 * I POZZETTI — Asse, Legenda, Valori, Filtri.
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
 * Non c'e' disegno libero ne' messa a punto fine del grafico: quelli restano a
 * Power BI Desktop (e al pannello Aspetto per le scelte di resa).
 */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SelezioneCampi, VocabolarioAlbero } from "@/components/prototipo-bi/albero-campi";
import {
  TIPO_MIME_CAMPO,
  contenutoPozzetti,
  deponi,
  iscriviTrascinamento,
  leggiTrascinamento,
  leggiVoceDalTrasferimento,
  spostaValore,
  togliVoce,
  vociDisponibili,
  type ContestoPozzetti,
  type NomePozzetto,
  type VoceCampo,
} from "@/components/prototipo-bi/pozzetti-regole";
import { VOCI_CALENDARIO } from "@/lib/prototipo-bi/gruppi-campi";
import type { ChiaveCampo } from "@/lib/prototipo-bi/misure-vocabolario";
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

function ruoloDelValore(chiave: ChiaveCampo, indice: number): string {
  if (indice === 0) return "principale";
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
  togli,
  sposta,
}: {
  etichetta: string;
  nota?: string;
  togli: { nome: string; onClick: () => void };
  sposta?: { prima?: () => void; dopo?: () => void };
}) {
  return (
    <li className="flex min-h-9 items-center gap-1 rounded-lg border border-border bg-bg-page py-1 pl-2 pr-1 text-sm">
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
      <span className="min-w-0 truncate">
        {etichetta}
        {nota && <span className="ml-1 text-xs text-text-muted">· {nota}</span>}
      </span>
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

function Pozzetto({
  nome,
  idoneo,
  onRilascia,
  menu,
  children,
  vuoto,
}: {
  nome: NomePozzetto;
  /** Se, mentre si trascina qualcosa, questo pozzetto lo accetterebbe (null = niente in corso). */
  idoneo: boolean | null;
  onRilascia: (voce: VoceCampo) => void;
  menu: ReactNode;
  children: ReactNode;
  vuoto: boolean;
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
      className={`rounded-xl border bg-bg p-3 transition-colors ${stato}`}
    >
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
    </section>
  );
}

export function Pozzetti({
  vocabolario,
  selezione,
  filtri,
  onCambia,
  onAggiungiFiltro,
  onTogliFiltro,
}: {
  vocabolario: VocabolarioAlbero;
  selezione: SelezioneCampi;
  /** I filtri della spec: non fanno parte della selezione, li gestisce chi usa il componente. */
  filtri: Filtro[];
  onCambia: (selezione: SelezioneCampi) => void;
  /** Aggiunge un filtro (senza valori) su questa dimensione. */
  onAggiungiFiltro: (dimensione: Dimensione) => void;
  onTogliFiltro: (indice: number) => void;
}) {
  const [messaggio, setMessaggio] = useState<Messaggio | null>(null);
  const inTrascinamento = useSyncExternalStore(iscriviTrascinamento, leggiTrascinamento, () => null);

  const etichettaDimensione = (chiave: Dimensione) =>
    vocabolario.dimensioni.find((d) => d.chiave === chiave)?.etichetta ?? chiave;

  const contesto = useMemo<ContestoPozzetti>(
    () => ({
      perMetrica: vocabolario.dimensioniPerMetrica,
      etichetta: (voce) => {
        if (voce.tipo === "misura") return vocabolario.metriche.find((m) => m.chiave === voce.chiave)?.etichetta ?? voce.chiave;
        if (voce.tipo === "dimensione") return etichettaDimensione(voce.chiave);
        return VOCI_CALENDARIO.find((c) => c.chiave === voce.chiave)?.etichetta ?? voce.chiave;
      },
    }),
    // etichettaDimensione dipende solo da vocabolario.dimensioni
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vocabolario.dimensioniPerMetrica, vocabolario.metriche, vocabolario.dimensioni]
  );

  const campi = useMemo(
    () => ({
      misure: vocabolario.tipologie.flatMap((t) => t.metriche),
      dimensioni: vocabolario.dimensioni.map((d) => d.chiave),
    }),
    [vocabolario.tipologie, vocabolario.dimensioni]
  );

  const contenuto = contenutoPozzetti(selezione);

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
    const esito = togliVoce(selezione, voce, contesto);
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
    const gruppi: Array<{ etichetta: string; voci: VoceCampo[] }> =
      pozzetto === "valori"
        ? vocabolario.tipologie
            .map((t) => ({
              etichetta: t.etichetta,
              voci: t.metriche
                .map((chiave): VoceCampo => ({ tipo: "misura", chiave }))
                .filter((v) => disponibili.some((d) => d.tipo === v.tipo && d.chiave === v.chiave)),
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
        className="h-9 w-full rounded-lg border border-border bg-bg-page px-2 text-xs text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">{disponibili.length === 0 ? "Niente da aggiungere" : "Aggiungi un campo…"}</option>
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

  const haFiltriDaCompletare = filtri.some((f) => riassuntoFiltro(f) === "da scegliere");

  return (
    <section aria-labelledby="titolo-pozzetti" className="mt-4">
      <div className="mb-2">
        <h3 id="titolo-pozzetti" className="font-tenorite text-sm font-bold uppercase tracking-wide">
          Pozzetti
        </h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Trascina un campo dall’albero nel pozzetto, oppure sceglilo dal menu del pozzetto. Il riquadro si ricalcola subito.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Pozzetto nome="asse" idoneo={idoneo("asse")} onRilascia={(v) => deponiVoce("asse", v)} vuoto={!contenuto.asse} menu={menu("asse")}>
          {contenuto.asse && (
            <Chip
              etichetta={contesto.etichetta(contenuto.asse)}
              nota={contenuto.asse.tipo === "calendario" ? "tempo" : undefined}
              togli={{ nome: `Togli ${contesto.etichetta(contenuto.asse)} dall'asse`, onClick: () => togliDa(contenuto.asse!) }}
            />
          )}
        </Pozzetto>

        <Pozzetto nome="legenda" idoneo={idoneo("legenda")} onRilascia={(v) => deponiVoce("legenda", v)} vuoto={contenuto.legenda.length === 0} menu={menu("legenda")}>
          {contenuto.legenda.map((voce) => (
            <Chip
              key={voce.chiave}
              etichetta={contesto.etichetta(voce)}
              togli={{ nome: `Togli ${contesto.etichetta(voce)} dalla legenda`, onClick: () => togliDa(voce) }}
            />
          ))}
        </Pozzetto>

        <Pozzetto nome="valori" idoneo={idoneo("valori")} onRilascia={(v) => deponiVoce("valori", v)} vuoto={contenuto.valori.length === 0} menu={menu("valori")}>
          {contenuto.valori.map((chiave, indice) => {
            const voce: VoceCampo = { tipo: "misura", chiave };
            const nome = contesto.etichetta(voce);
            return (
              <Chip
                key={chiave}
                etichetta={nome}
                nota={ruoloDelValore(chiave, indice)}
                togli={{ nome: `Togli ${nome} dai valori`, onClick: () => togliDa(voce) }}
                sposta={{
                  prima: indice > 0 ? () => onCambia(spostaValore(selezione, indice, indice - 1)) : undefined,
                  dopo: indice < contenuto.valori.length - 1 ? () => onCambia(spostaValore(selezione, indice, indice + 1)) : undefined,
                }}
              />
            );
          })}
        </Pozzetto>

        <Pozzetto nome="filtri" idoneo={idoneo("filtri")} onRilascia={(v) => deponiVoce("filtri", v)} vuoto={filtri.length === 0} menu={menu("filtri")}>
          {filtri.map((f, indice) => (
            <Chip
              key={`${f.campo}-${indice}`}
              etichetta={`${etichettaDimensione(f.campo === "bu_categoria" ? "bu" : f.campo)}: ${riassuntoFiltro(f)}`}
              togli={{ nome: `Togli il filtro su ${etichettaDimensione(f.campo === "bu_categoria" ? "bu" : f.campo)}`, onClick: () => onTogliFiltro(indice) }}
            />
          ))}
        </Pozzetto>
      </div>

      {haFiltriDaCompletare && (
        <p className="mt-2 text-xs text-text-muted">
          I valori dei filtri si scelgono nel riquadro «Solo dove».{" "}
          <button
            type="button"
            onClick={() => document.getElementById("editor-filtri")?.scrollIntoView?.({ behavior: "smooth", block: "center" })}
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
          messaggio
            ? `mt-2 rounded-lg border p-2 text-xs ${messaggio.tipo === "rifiuto" ? "border-warning/40 bg-warning/5" : "border-primary/40 bg-primary/5"}`
            : "sr-only"
        }
      >
        {messaggio?.testo ?? ""}
      </p>
    </section>
  );
}
