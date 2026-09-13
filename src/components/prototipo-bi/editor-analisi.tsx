"use client";

/**
 * L'EDITOR MANUALE DELLE ANALISI.
 *
 * Quattro scelte — cosa guardo, come lo spezzo, quando, solo dove — e sotto il
 * risultato che si aggiorna da solo. Nessun pulsante "esegui": si cambia una
 * voce e il grafico cambia, con 400 ms di attesa perché altrimenti ogni tasto
 * premuto in un filtro sarebbe una chiamata.
 *
 * L'oggetto che si compone qui è lo stesso `SpecQuery` che produce l'analista
 * AI. Non è un dettaglio implementativo: è la ragione per cui un'analisi
 * suggerita dall'AI si apre qui e si corregge, e una fatta a mano si può
 * passare all'AI. Un solo motore, due modi di imboccarlo — e uno solo da
 * tenere in sicurezza.
 *
 * Il limite di due dimensioni non è pigrizia: oltre le due non esiste grafico
 * che le rappresenti, e lasciar scegliere per poi ripiegare su una tabella
 * sarebbe peggio che dirlo prima.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { GraficoDaRisultato } from "@/components/prototipo-bi/grafico-da-risultato";
import { Scheda, Scheletro, euro, numero } from "@/components/prototipo-bi/primitivi";
import {
  graficiPossibili,
  scegliGrafico,
  type TipoGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import type {
  ChiaveMetrica,
  Dimensione,
  Filtro,
  Granularita,
  Modificatore,
  RisultatoQuery,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";

interface VoceMetrica {
  chiave: ChiaveMetrica;
  etichetta: string;
  descrizione: string;
  unita: string;
}

interface VoceDimensione {
  chiave: Dimensione;
  etichetta: string;
}

interface VoceModificatore {
  chiave: Modificatore;
  descrizione: string;
}

interface Vocabolario {
  metriche: VoceMetrica[];
  dimensioni: VoceDimensione[];
  modificatori: VoceModificatore[];
  granularita: Granularita[];
}

const NOMI_GRAFICI: Record<TipoGrafico, string> = {
  linee: "Linee",
  barre: "Barre",
  combo: "Combinato",
  torta: "Torta",
  anelli: "Anelli",
  areeImpilate: "Aree impilate",
  pareto: "Pareto",
  bullet: "Bullet",
  heatmap: "Mappa di calore",
  quadranti: "Quadranti",
  imbuto: "Imbuto",
  treemap: "Mappa ad albero",
  sparkline: "Sparkline",
  kpi: "KPI",
  tabella: "Tabella",
};

const NOMI_OPERATORI: Record<Filtro["op"], string> = {
  eq: "è uguale a",
  neq: "è diverso da",
  in: "è uno tra",
  contiene: "contiene",
};

const CLASSE_CAMPO =
  "min-h-10 w-full rounded-lg border border-border bg-bg-page px-3 text-sm outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function messaggioErrore(corpo: unknown, ripiego: string): string {
  return eOggetto(corpo) && typeof corpo.error === "string" ? corpo.error : ripiego;
}

function costruisciTitolo(spec: SpecQuery, vocabolario: Vocabolario): string {
  const metrica = vocabolario.metriche.find((voce) => voce.chiave === spec.metrica)?.etichetta;
  const dimensioni = (spec.raggruppa ?? [])
    .map((chiave) =>
      vocabolario.dimensioni.find((voce) => voce.chiave === chiave)?.etichetta.toLocaleLowerCase("it")
    )
    .filter((voce): voce is string => Boolean(voce));
  const parti = [metrica ?? spec.metrica];
  if (dimensioni.length > 0) parti.push(`per ${dimensioni.join(" e ")}`);
  if (spec.periodo?.anno) parti.push(String(spec.periodo.anno));
  else if (spec.periodo?.dal || spec.periodo?.al) {
    parti.push([spec.periodo.dal, spec.periodo.al].filter(Boolean).join(" – "));
  }
  return parti.join(", ");
}

function valoreFiltroPerCampo(filtro: Filtro): string {
  return Array.isArray(filtro.valore) ? filtro.valore.join(", ") : filtro.valore;
}

function formattaTotale(risultato: RisultatoQuery): string {
  if (risultato.unita === "euro") return euro(risultato.totale, false);
  if (risultato.unita === "percentuale") {
    return `${risultato.totale.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
  }
  if (risultato.unita === "giorni") {
    return `${risultato.totale.toLocaleString("it-IT", { maximumFractionDigits: 1 })} giorni`;
  }
  return numero(risultato.totale);
}

export function EditorAnalisi({
  specIniziale,
  titoloIniziale,
  graficoIniziale,
  onSalvata,
}: {
  specIniziale?: SpecQuery;
  titoloIniziale?: string;
  graficoIniziale?: TipoGrafico;
  onSalvata?: (id: string) => void;
}): JSX.Element {
  const [vocabolario, setVocabolario] = useState<Vocabolario | null>(null);
  const [spec, setSpec] = useState<SpecQuery | null>(specIniziale ?? null);
  const [risultato, setRisultato] = useState<RisultatoQuery | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [erroreVocabolario, setErroreVocabolario] = useState("");
  const [titolo, setTitolo] = useState(titoloIniziale ?? "");
  const [graficoScelto, setGraficoScelto] = useState<TipoGrafico | undefined>(graficoIniziale);
  const [salvataggio, setSalvataggio] = useState<"pronto" | "in_corso" | "salvata">("pronto");
  const [messaggioSalvataggio, setMessaggioSalvataggio] = useState("");
  const titoloModificato = useRef(Boolean(titoloIniziale));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bi/query", { signal: controller.signal })
      .then(async (risposta) => {
        const corpo: unknown = await risposta.json();
        if (!risposta.ok) throw new Error(messaggioErrore(corpo, "Vocabolario non disponibile."));
        return corpo as Vocabolario;
      })
      .then((dati) => {
        setVocabolario(dati);
        setSpec((corrente) =>
          corrente ?? {
            metrica: dati.metriche[0]?.chiave ?? "ordinato",
            modificatore: "corrente",
            periodo: { anno: new Date().getFullYear() },
          }
        );
      })
      .catch((causa: unknown) => {
        if (causa instanceof DOMException && causa.name === "AbortError") return;
        setErroreVocabolario(
          causa instanceof Error ? causa.message : "Vocabolario non disponibile."
        );
      });
    return () => controller.abort();
  }, []);

  const chiaveSpec = useMemo(() => (spec ? JSON.stringify(spec) : ""), [spec]);

  useEffect(() => {
    if (!vocabolario || !spec) return;
    const controller = new AbortController();
    setCaricamento(true);
    setErrore("");

    // Il ritardo accorpa anche la digitazione libera dei filtri, che altrimenti
    // trasformerebbe ogni carattere in una query certificata completa.
    const attesa = window.setTimeout(() => {
      fetch("/api/bi/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
        signal: controller.signal,
      })
        .then(async (risposta) => {
          const corpo: unknown = await risposta.json();
          if (!risposta.ok) throw new Error(messaggioErrore(corpo, "Analisi non eseguibile."));
          if (!eOggetto(corpo) || !eOggetto(corpo.risultato)) {
            throw new Error("Il motore ha restituito una risposta incompleta.");
          }
          return corpo.risultato as unknown as RisultatoQuery;
        })
        .then((nuovoRisultato) => {
          setRisultato(nuovoRisultato);
          setErrore("");
        })
        .catch((causa: unknown) => {
          if (causa instanceof DOMException && causa.name === "AbortError") return;
          setErrore(causa instanceof Error ? causa.message : "Analisi non eseguibile.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setCaricamento(false);
        });
    }, 400);

    return () => {
      window.clearTimeout(attesa);
      controller.abort();
    };
  }, [chiaveSpec, spec, vocabolario]);

  useEffect(() => {
    if (!spec || !vocabolario || titoloModificato.current) return;
    setTitolo(costruisciTitolo(spec, vocabolario));
  }, [chiaveSpec, spec, vocabolario]);

  const proposta = risultato ? scegliGrafico(risultato) : null;
  const grafici = risultato ? graficiPossibili(risultato) : [];
  const tipoGrafico =
    graficoScelto && grafici.includes(graficoScelto) ? graficoScelto : proposta?.tipo;
  const dimensioniScelte = spec?.raggruppa ?? [];
  const limiteDimensioniRaggiunto = dimensioniScelte.length >= 2;

  function aggiornaSpec(aggiornamento: (corrente: SpecQuery) => SpecQuery) {
    setSpec((corrente) => (corrente ? aggiornamento(corrente) : corrente));
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function cambiaDimensione(dimensione: Dimensione, selezionata: boolean) {
    aggiornaSpec((corrente) => {
      const raggruppa = corrente.raggruppa ?? [];
      return {
        ...corrente,
        raggruppa: selezionata
          ? [...raggruppa, dimensione].slice(0, 2)
          : raggruppa.filter((voce) => voce !== dimensione),
      };
    });
  }

  function aggiornaFiltro(indice: number, filtro: Filtro) {
    aggiornaSpec((corrente) => ({
      ...corrente,
      filtri: (corrente.filtri ?? []).map((voce, posizione) =>
        posizione === indice ? filtro : voce
      ),
    }));
  }

  async function salva() {
    const titoloPulito = titolo.trim();
    if (!titoloPulito) {
      setMessaggioSalvataggio("Il titolo è obbligatorio.");
      return;
    }
    if (!spec || salvataggio === "in_corso") return;

    setSalvataggio("in_corso");
    setMessaggioSalvataggio("");
    try {
      const risposta = await fetch("/api/bi/analisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titolo: titoloPulito,
          spec,
          ...(tipoGrafico ? { grafico: tipoGrafico } : {}),
        }),
      });
      const corpo: unknown = await risposta.json();
      if (!risposta.ok) {
        throw new Error(messaggioErrore(corpo, "Salvataggio non riuscito."));
      }
      const id =
        eOggetto(corpo) && eOggetto(corpo.analisi) && typeof corpo.analisi.id === "string"
          ? corpo.analisi.id
          : null;
      if (!id) throw new Error("Il salvataggio non ha restituito un identificativo.");
      setSalvataggio("salvata");
      setMessaggioSalvataggio("Analisi salvata.");
      onSalvata?.(id);
    } catch (causa) {
      setSalvataggio("pronto");
      setMessaggioSalvataggio(
        causa instanceof Error ? causa.message : "Salvataggio non riuscito."
      );
    }
  }

  if (erroreVocabolario) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <p role="alert" className="rounded-xl border border-border bg-bg-page p-4 text-danger">
          {erroreVocabolario}
        </p>
      </main>
    );
  }

  if (!vocabolario || !spec) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <Scheletro altezza={520} />
      </main>
    );
  }

  const metricaScelta = vocabolario.metriche.find((voce) => voce.chiave === spec.metrica);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6">
      <header className="mb-6 max-w-3xl">
        <h1 className="font-tenorite text-3xl font-semibold">Componi un’analisi</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Costruisci la stessa domanda certificata che usa l’Analista AI. Ogni scelta aggiorna
          subito il risultato e può essere riaperta, modificata o condivisa.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.5fr)] xl:items-start">
        <div className="space-y-4">
          <Scheda titolo="Cosa guardo" sottotitolo="Scegli la misura certificata">
            <label className="text-sm font-medium" htmlFor="editor-metrica">
              Metrica
            </label>
            <select
              id="editor-metrica"
              aria-label="Metrica"
              value={spec.metrica}
              onChange={(evento) =>
                aggiornaSpec((corrente) => ({
                  ...corrente,
                  metrica: evento.target.value as ChiaveMetrica,
                }))
              }
              className={`${CLASSE_CAMPO} mt-2`}
            >
              {vocabolario.metriche.map((metrica) => (
                <option key={metrica.chiave} value={metrica.chiave}>
                  {metrica.etichetta}
                </option>
              ))}
            </select>
            {metricaScelta && (
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                {metricaScelta.descrizione}
              </p>
            )}
          </Scheda>

          <Scheda titolo="Come lo spezzo" sottotitolo="Fino a due dimensioni">
            <fieldset>
              <legend className="sr-only">Dimensioni</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {vocabolario.dimensioni.map((dimensione) => {
                  const selezionata = dimensioniScelte.includes(dimensione.chiave);
                  const disabilitata = limiteDimensioniRaggiunto && !selezionata;
                  return (
                    <label
                      key={dimensione.chiave}
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-bg-page px-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                    >
                      <input
                        type="checkbox"
                        checked={selezionata}
                        disabled={disabilitata}
                        onChange={(evento) =>
                          cambiaDimensione(dimensione.chiave, evento.target.checked)
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      {dimensione.etichetta}
                    </label>
                  );
                })}
              </div>
              <p className={`mt-2 text-xs ${limiteDimensioniRaggiunto ? "text-warning" : "text-text-muted"}`}>
                {limiteDimensioniRaggiunto
                  ? "Hai scelto due dimensioni: è il massimo rappresentabile in un grafico. Deselezionane una per cambiarla."
                  : "Puoi scegliere ancora fino a due dimensioni complessive."}
              </p>
            </fieldset>
          </Scheda>

          <Scheda titolo="Quando" sottotitolo="Periodo, dettaglio temporale e confronto">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <label className="text-xs text-text-muted">
                Anno
                <input
                  aria-label="Anno"
                  type="number"
                  min={2000}
                  max={2100}
                  value={spec.periodo?.anno ?? ""}
                  placeholder="Tutti"
                  onChange={(evento) => {
                    const anno = evento.target.value ? Number(evento.target.value) : undefined;
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      periodo: anno ? { anno } : {},
                    }));
                  }}
                  className={`${CLASSE_CAMPO} mt-1`}
                />
              </label>
              <label className="text-xs text-text-muted">
                Dal
                <input
                  aria-label="Dal"
                  type="date"
                  value={spec.periodo?.dal ?? ""}
                  onChange={(evento) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      periodo: {
                        dal: evento.target.value || undefined,
                        al: corrente.periodo?.al,
                      },
                    }))
                  }
                  className={`${CLASSE_CAMPO} mt-1`}
                />
              </label>
              <label className="text-xs text-text-muted">
                Al
                <input
                  aria-label="Al"
                  type="date"
                  value={spec.periodo?.al ?? ""}
                  onChange={(evento) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      periodo: {
                        dal: corrente.periodo?.dal,
                        al: evento.target.value || undefined,
                      },
                    }))
                  }
                  className={`${CLASSE_CAMPO} mt-1`}
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <label className="text-xs text-text-muted">
                Granularità
                <select
                  aria-label="Granularità"
                  value={spec.granularita ?? ""}
                  onChange={(evento) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      granularita: (evento.target.value || undefined) as Granularita | undefined,
                    }))
                  }
                  className={`${CLASSE_CAMPO} mt-1`}
                >
                  <option value="">Totale del periodo</option>
                  {vocabolario.granularita.map((granularita) => (
                    <option key={granularita} value={granularita}>
                      {granularita[0].toLocaleUpperCase("it") + granularita.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-text-muted">
                Confronto
                <select
                  aria-label="Confronto"
                  value={spec.modificatore ?? "corrente"}
                  onChange={(evento) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      modificatore: evento.target.value as Modificatore,
                    }))
                  }
                  className={`${CLASSE_CAMPO} mt-1`}
                >
                  {vocabolario.modificatori.map((modificatore) => (
                    <option key={modificatore.chiave} value={modificatore.chiave}>
                      {modificatore.descrizione}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Scheda>

          <Scheda
            titolo="Solo dove"
            sottotitolo="Restringi l’analisi con filtri espliciti"
            azione={
              <button
                type="button"
                onClick={() =>
                  aggiornaSpec((corrente) => ({
                    ...corrente,
                    filtri: [
                      ...(corrente.filtri ?? []),
                      { campo: vocabolario.dimensioni[0]?.chiave ?? "bu", op: "eq", valore: "" },
                    ],
                  }))
                }
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-bg-page px-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Aggiungi
              </button>
            }
          >
            {(spec.filtri ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">Nessun filtro: stai guardando l’intero perimetro disponibile.</p>
            ) : (
              <div className="space-y-3">
                {(spec.filtri ?? []).map((filtro, indice) => (
                  <div key={indice} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
                    <select
                      aria-label={`Dimensione filtro ${indice + 1}`}
                      value={filtro.campo}
                      onChange={(evento) =>
                        aggiornaFiltro(indice, {
                          ...filtro,
                          campo: evento.target.value as Dimensione,
                        })
                      }
                      className={CLASSE_CAMPO}
                    >
                      {vocabolario.dimensioni.map((dimensione) => (
                        <option key={dimensione.chiave} value={dimensione.chiave}>
                          {dimensione.etichetta}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Operatore filtro ${indice + 1}`}
                      value={filtro.op}
                      onChange={(evento) => {
                        const op = evento.target.value as Filtro["op"];
                        const valore =
                          op === "in"
                            ? valoreFiltroPerCampo(filtro)
                                .split(",")
                                .map((voce) => voce.trim())
                                .filter(Boolean)
                            : valoreFiltroPerCampo(filtro);
                        aggiornaFiltro(indice, { ...filtro, op, valore });
                      }}
                      className={CLASSE_CAMPO}
                    >
                      {Object.entries(NOMI_OPERATORI).map(([op, nome]) => (
                        <option key={op} value={op}>
                          {nome}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Valore filtro ${indice + 1}`}
                      value={valoreFiltroPerCampo(filtro)}
                      placeholder={filtro.op === "in" ? "Valori separati da virgola" : "Valore"}
                      onChange={(evento) =>
                        aggiornaFiltro(indice, {
                          ...filtro,
                          valore:
                            filtro.op === "in"
                              ? evento.target.value.split(",").map((voce) => voce.trim())
                              : evento.target.value,
                        })
                      }
                      className={CLASSE_CAMPO}
                    />
                    <button
                      type="button"
                      aria-label={`Rimuovi filtro ${indice + 1}`}
                      onClick={() =>
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          filtri: (corrente.filtri ?? []).filter((_, posizione) => posizione !== indice),
                        }))
                      }
                      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border bg-bg-page text-danger focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Scheda>
        </div>

        <section className="min-w-0 xl:sticky xl:top-4">
          <Scheda
            titolo="Risultato in tempo reale"
            sottotitolo="La domanda viene rieseguita dopo ogni modifica"
            azione={
              risultato ? (
                <div className="text-right">
                  <p className="text-xs text-text-muted">Totale</p>
                  <p className="font-tenorite text-xl font-semibold text-primary tabular-nums">
                    {formattaTotale(risultato)}
                  </p>
                </div>
              ) : null
            }
          >
            {errore && (
              <p role="alert" className="mb-4 rounded-lg border border-border bg-bg-page p-3 text-sm text-danger">
                {errore}
              </p>
            )}

            <div className="relative min-h-[340px]" aria-busy={caricamento}>
              {risultato && tipoGrafico ? (
                <div className={caricamento ? "opacity-50" : undefined}>
                  <GraficoDaRisultato risultato={risultato} tipo={tipoGrafico} altezza={340} />
                </div>
              ) : (
                <Scheletro altezza={340} />
              )}
              {caricamento && risultato && (
                <div className="pointer-events-none absolute inset-0 opacity-50">
                  <Scheletro altezza={340} />
                </div>
              )}
            </div>

            {risultato && proposta && tipoGrafico && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                  <div>
                    <p className="text-xs font-medium">Grafico proposto: {NOMI_GRAFICI[proposta.tipo]}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{proposta.motivo}</p>
                  </div>
                  <label className="text-xs text-text-muted">
                    Visualizzazione
                    <select
                      aria-label="Visualizzazione"
                      value={tipoGrafico}
                      onChange={(evento) => setGraficoScelto(evento.target.value as TipoGrafico)}
                      className={`${CLASSE_CAMPO} mt-1`}
                    >
                      {grafici.map((tipo) => (
                        <option key={tipo} value={tipo}>
                          {NOMI_GRAFICI[tipo]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {risultato.avvisi.length > 0 && (
                  <div className="mt-4 space-y-2" aria-label="Avvisi del risultato">
                    {risultato.avvisi.map((avviso) => (
                      <p key={avviso} className="rounded-lg border border-border bg-bg-page p-3 text-xs leading-relaxed text-warning">
                        {avviso}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 border-t border-border pt-5">
              <label htmlFor="editor-titolo" className="text-sm font-medium">
                Titolo dell’analisi
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="editor-titolo"
                  aria-label="Titolo dell’analisi"
                  required
                  value={titolo}
                  onChange={(evento) => {
                    titoloModificato.current = true;
                    setTitolo(evento.target.value);
                    setSalvataggio("pronto");
                    setMessaggioSalvataggio("");
                  }}
                  className={`${CLASSE_CAMPO} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => void salva()}
                  disabled={salvataggio === "in_corso" || salvataggio === "salvata"}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-bg-page px-4 text-sm font-medium text-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" aria-hidden />
                  {salvataggio === "in_corso" ? "Salvataggio…" : salvataggio === "salvata" ? "Salvata" : "Salva analisi"}
                </button>
              </div>
              {messaggioSalvataggio && (
                <p
                  role="status"
                  className={`mt-2 text-xs ${salvataggio === "salvata" ? "text-primary" : "text-danger"}`}
                >
                  {messaggioSalvataggio}
                </p>
              )}
            </div>
          </Scheda>
        </section>
      </div>
    </main>
  );
}
