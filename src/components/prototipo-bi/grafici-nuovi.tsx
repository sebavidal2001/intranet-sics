"use client";

import { useState } from "react";
import type { AggregazioneTotale, RisultatoQuery, UnitaMisura } from "@/lib/prototipo-bi/tipi";
import { useImpostazioni } from "./impostazioni";
import { valoreFmt, Vuoto } from "./primitivi";

interface ProprietaGraficoNuovo {
  risultato: RisultatoQuery;
  altezza?: number;
  onClick?: (etichetta: string) => void;
}

interface PuntoCategoria {
  categoria: string;
  valori: Map<string, number>;
}

const LARGHEZZA = 800;
const MARGINE = { sopra: 34, destra: 92, sotto: 50, sinistra: 92 };

function periodiDi(risultato: RisultatoQuery): string[] {
  return [...new Set(
    risultato.righe
      .map((riga) => riga.chiavi.periodo)
      .filter((periodo): periodo is string => Boolean(periodo))
  )].sort();
}

function seriePerCategoria(risultato: RisultatoQuery): PuntoCategoria[] {
  const dimensione = risultato.spec.raggruppa?.[0];
  if (!dimensione) return [];
  const categorie = new Map<string, Map<string, number>>();
  for (const riga of risultato.righe) {
    const categoria = riga.chiavi[dimensione];
    const periodo = riga.chiavi.periodo;
    if (!categoria || !periodo) continue;
    const valori = categorie.get(categoria) ?? new Map<string, number>();
    valori.set(periodo, (valori.get(periodo) ?? 0) + riga.valore);
    categorie.set(categoria, valori);
  }
  return [...categorie].map(([categoria, valori]) => ({ categoria, valori }));
}

function formatta(valore: number, unita: UnitaMisura, compatto: boolean): string {
  return valoreFmt(valore, unita, compatto);
}

function limitaTesto(testo: string, massimo = 18): string {
  return testo.length > massimo ? `${testo.slice(0, massimo - 1)}…` : testo;
}

function scalaLineare(
  valore: number,
  minimo: number,
  massimo: number,
  inizio: number,
  fine: number
): number {
  if (massimo === minimo) return (inizio + fine) / 2;
  return inizio + ((valore - minimo) / (massimo - minimo)) * (fine - inizio);
}

function gestisciTastiera(
  evento: React.KeyboardEvent<SVGGElement>,
  azione: (() => void) | undefined
) {
  if (!azione || (evento.key !== "Enter" && evento.key !== " ")) return;
  evento.preventDefault();
  azione();
}

/**
 * Riassume i valori di una riga o colonna della matrice.
 *
 * In automatico somma euro e conteggi, e lascia vuoto per percentuali e
 * giorni: prima sommava tutto, e una matrice di tassi di conversione
 * chiudeva con un «totale» del 340%.
 */
function aggregaMargine(valori: number[], aggregazione: AggregazioneTotale, unita: UnitaMisura): number | null {
  const efficace =
    aggregazione === "automatico" ? (unita === "percentuale" || unita === "giorni" ? "nessuno" : "somma") : aggregazione;
  if (efficace === "conteggio") return valori.length;
  if (efficace === "nessuno" || valori.length === 0) return null;
  if (efficace === "somma") return unita === "percentuale" ? null : valori.reduce((a, b) => a + b, 0);
  if (efficace === "media") return valori.reduce((a, b) => a + b, 0) / valori.length;
  if (efficace === "minimo") return valori.reduce((a, b) => Math.min(a, b));
  return valori.reduce((a, b) => Math.max(a, b));
}

const COLONNA_RIGHE = "\u0000righe";
const COLONNA_TOTALE = "\u0000totale";

/** Tabella pivot con totali marginali, pensata per incroci compatti. */
export function Matrice({ risultato, onClick }: ProprietaGraficoNuovo) {
  const { imp, colore, aspetto } = useImpostazioni();
  const [ordinaPer, setOrdinaPer] = useState<string>(
    aspetto?.tabella?.ordinaPer === "valore" ? COLONNA_TOTALE : COLONNA_RIGHE
  );
  const [discendente, setDiscendente] = useState(
    aspetto?.tabella?.verso ? aspetto.tabella.verso === "desc" : aspetto?.tabella?.ordinaPer === "valore"
  );
  const [aggregazione, setAggregazione] = useState<AggregazioneTotale>(aspetto?.tabella?.totale ?? "automatico");
  const dimensioni = risultato.spec.raggruppa ?? [];
  if (dimensioni.length !== 2) {
    return <Vuoto testo="La matrice richiede esattamente due raggruppamenti." />;
  }

  const [dimensioneRiga, dimensioneColonna] = dimensioni;
  const nomiRigaGrezzi = [...new Set(risultato.righe.map((riga) => riga.chiavi[dimensioneRiga]).filter(Boolean))];
  const nomiColonna = [...new Set(risultato.righe.map((riga) => riga.chiavi[dimensioneColonna]).filter(Boolean))];
  if (nomiRigaGrezzi.length === 0 || nomiColonna.length === 0) {
    return <Vuoto testo="La matrice richiede valori in entrambe le dimensioni." />;
  }

  const celle = new Map<string, number>();
  for (const riga of risultato.righe) {
    const nomeRiga = riga.chiavi[dimensioneRiga];
    const nomeColonna = riga.chiavi[dimensioneColonna];
    if (!nomeRiga || !nomeColonna) continue;
    const chiave = `${nomeRiga}\u0000${nomeColonna}`;
    celle.set(chiave, (celle.get(chiave) ?? 0) + riga.valore);
  }
  const valoriRiga = (nomeRiga: string) =>
    nomiColonna.flatMap((nomeColonna) => {
      const v = celle.get(`${nomeRiga}\u0000${nomeColonna}`);
      return v === undefined ? [] : [v];
    });
  const valoriColonna = (nomeColonna: string) =>
    nomiRigaGrezzi.flatMap((nomeRiga) => {
      const v = celle.get(`${nomeRiga}\u0000${nomeColonna}`);
      return v === undefined ? [] : [v];
    });
  const totaleRiga = (nomeRiga: string) => aggregaMargine(valoriRiga(nomeRiga), aggregazione, risultato.unita);
  const totaleColonna = (nomeColonna: string) =>
    aggregaMargine(valoriColonna(nomeColonna), aggregazione, risultato.unita);
  const totaleGenerale = aggregaMargine([...celle.values()], aggregazione, risultato.unita);
  const mostraTotali = aggregazione !== "nessuno";

  const confronta = new Intl.Collator("it", { numeric: true, sensitivity: "base" }).compare;
  const chiaveOrdinamento = (nomeRiga: string): number => {
    if (ordinaPer === COLONNA_TOTALE) return totaleRiga(nomeRiga) ?? Number.NEGATIVE_INFINITY;
    return celle.get(`${nomeRiga}\u0000${ordinaPer}`) ?? Number.NEGATIVE_INFINITY;
  };
  const nomiRiga = [...nomiRigaGrezzi].sort((a, b) => {
    const esito = ordinaPer === COLONNA_RIGHE ? confronta(a, b) : chiaveOrdinamento(a) - chiaveOrdinamento(b);
    return discendente ? -esito : esito;
  });

  function ordina(chiave: string) {
    if (ordinaPer === chiave) setDiscendente((d) => !d);
    else {
      setOrdinaPer(chiave);
      setDiscendente(chiave !== COLONNA_RIGHE);
    }
  }
  const freccia = (chiave: string) =>
    ordinaPer === chiave ? (discendente ? " ↓" : " ↑") : "";
  const cella = (valore: number | null) =>
    valore === null ? "—" : aggregazione === "conteggio" ? String(valore) : formatta(valore, risultato.unita, imp.numeriCompatti);
  const spaziatura = imp.densita === "compatta" ? "px-2 py-1.5" : "px-3 py-2.5";
  const intestazioneOrdinabile = (chiave: string, testo: string, allineamento: string) => (
    <button
      type="button"
      onClick={() => ordina(chiave)}
      aria-label={`Ordina per ${testo}`}
      className={`w-full ${allineamento} hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary ${ordinaPer === chiave ? "text-primary" : ""}`}
    >
      {testo}
      {freccia(chiave)}
    </button>
  );

  return (
    <div>
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-collapse text-xs">
        <caption className="sr-only">
          Matrice {dimensioneRiga} per {dimensioneColonna}, con totali di riga e colonna
        </caption>
        <thead className="bg-bg-page text-text-muted">
          <tr>
            <th scope="col" className={`${spaziatura} sticky left-0 z-10 bg-bg-page text-left font-semibold`}>
              {intestazioneOrdinabile(COLONNA_RIGHE, dimensioneRiga, "text-left")}
            </th>
            {nomiColonna.map((nome) => (
              <th key={nome} scope="col" className={`${spaziatura} whitespace-nowrap text-right font-semibold`}>
                {intestazioneOrdinabile(nome, nome, "text-right")}
              </th>
            ))}
            {mostraTotali && (
              <th scope="col" className={`${spaziatura} whitespace-nowrap text-right font-semibold text-text`}>
                {intestazioneOrdinabile(COLONNA_TOTALE, NOMI_AGGREGAZIONE_BREVI[aggregazione], "text-right")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {nomiRiga.map((nomeRiga, indice) => (
            <tr key={nomeRiga} className="border-t border-border hover:bg-primary/5">
              <th scope="row" className={`${spaziatura} sticky left-0 bg-bg text-left font-medium`}>
                <button
                  type="button"
                  className="rounded-sm text-left underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary"
                  onClick={() => onClick?.(nomeRiga)}
                >
                  {nomeRiga}
                </button>
              </th>
              {nomiColonna.map((nomeColonna) => {
                const valore = celle.get(`${nomeRiga}\u0000${nomeColonna}`) ?? 0;
                return (
                  <td
                    key={nomeColonna}
                    className={`${spaziatura} text-right tabular-nums`}
                    style={{ backgroundColor: valore === 0 ? undefined : `${colore(indice)}14` }}
                  >
                    {formatta(valore, risultato.unita, imp.numeriCompatti)}
                  </td>
                );
              })}
              {mostraTotali && (
                <td className={`${spaziatura} bg-bg-page text-right font-semibold tabular-nums`}>
                  {cella(totaleRiga(nomeRiga))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {mostraTotali && (
          <tfoot className="border-t-2 border-border bg-bg-page font-semibold">
            <tr>
              <th scope="row" className={`${spaziatura} sticky left-0 bg-bg-page text-left`}>
                {NOMI_AGGREGAZIONE_BREVI[aggregazione]}
              </th>
              {nomiColonna.map((nome) => (
                <td key={nome} className={`${spaziatura} text-right tabular-nums`}>
                  {cella(totaleColonna(nome))}
                </td>
              ))}
              <td className={`${spaziatura} text-right text-primary tabular-nums`}>{cella(totaleGenerale)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
      <label className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
        Totali
        <select
          aria-label="Totali della matrice"
          value={aggregazione}
          onChange={(e) => setAggregazione(e.target.value as AggregazioneTotale)}
          className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-text outline-none focus:ring-2 focus:ring-primary"
        >
          {(Object.keys(NOMI_AGGREGAZIONE_BREVI) as AggregazioneTotale[]).map((chiave) => (
            <option key={chiave} value={chiave}>
              {chiave === "automatico" ? "Automatico" : chiave === "nessuno" ? "Nessuno" : NOMI_AGGREGAZIONE_BREVI[chiave]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const NOMI_AGGREGAZIONE_BREVI: Record<AggregazioneTotale, string> = {
  automatico: "Totale",
  somma: "Somma",
  media: "Media",
  minimo: "Minimo",
  massimo: "Massimo",
  conteggio: "Conteggio",
  nessuno: "Totale",
};

/** Confronta due soli periodi e mette in primo piano direzione e ampiezza. */
export function Pendenza({ risultato, altezza = 320, onClick }: ProprietaGraficoNuovo) {
  const { imp, palette, durata } = useImpostazioni();
  const periodi = periodiDi(risultato);
  const tutte = seriePerCategoria(risultato);
  if ((risultato.spec.raggruppa?.length ?? 0) !== 1 || !risultato.spec.granularita) {
    return <Vuoto altezza={altezza} testo="La pendenza richiede un raggruppamento e una granularità temporale." />;
  }
  if (periodi.length !== 2) {
    return <Vuoto altezza={altezza} testo="La pendenza richiede esattamente due periodi." />;
  }
  const categorie = tutte
    .filter((voce) => voce.valori.has(periodi[0]) && voce.valori.has(periodi[1]))
    .sort((a, b) => Math.abs((b.valori.get(periodi[1]) ?? 0) - (b.valori.get(periodi[0]) ?? 0)) - Math.abs((a.valori.get(periodi[1]) ?? 0) - (a.valori.get(periodi[0]) ?? 0)))
    .slice(0, imp.topN);
  if (categorie.length === 0) {
    return <Vuoto altezza={altezza} testo="Servono categorie presenti in entrambi i periodi." />;
  }
  const valori = categorie.flatMap((voce) => periodi.map((periodo) => voce.valori.get(periodo) ?? 0));
  const minimo = Math.min(...valori);
  const massimo = Math.max(...valori);
  const y = (valore: number) => scalaLineare(valore, minimo, massimo, altezza - MARGINE.sotto, MARGINE.sopra);
  const xInizio = 190;
  const xFine = LARGHEZZA - 190;

  return (
    <svg viewBox={`0 0 ${LARGHEZZA} ${altezza}`} className="h-auto w-full" role="img" aria-label={`Grafico di pendenza tra ${periodi[0]} e ${periodi[1]}`}>
      <title>Pendenza tra {periodi[0]} e {periodi[1]}</title>
      <text x={xInizio} y={20} textAnchor="middle" className="fill-text-muted text-[12px] font-semibold">{periodi[0]}</text>
      <text x={xFine} y={20} textAnchor="middle" className="fill-text-muted text-[12px] font-semibold">{periodi[1]}</text>
      {imp.mostraGriglia && <>
        <line x1={xInizio} x2={xInizio} y1={MARGINE.sopra} y2={altezza - MARGINE.sotto} stroke={palette.neutro} strokeOpacity="0.35" />
        <line x1={xFine} x2={xFine} y1={MARGINE.sopra} y2={altezza - MARGINE.sotto} stroke={palette.neutro} strokeOpacity="0.35" />
      </>}
      {categorie.map((voce) => {
        const primo = voce.valori.get(periodi[0]) ?? 0;
        const ultimo = voce.valori.get(periodi[1]) ?? 0;
        const tinta = ultimo >= primo ? palette.positivo : palette.negativo;
        return (
          <g
            key={voce.categoria}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            className={onClick ? "cursor-pointer outline-none" : undefined}
            onClick={() => onClick?.(voce.categoria)}
            onKeyDown={(evento) => gestisciTastiera(evento, onClick ? () => onClick(voce.categoria) : undefined)}
          >
            <line x1={xInizio} y1={y(primo)} x2={xFine} y2={y(ultimo)} stroke={tinta} strokeWidth="2.5" style={{ transition: `all ${durata}ms ease-out` }} />
            <circle cx={xInizio} cy={y(primo)} r="4" fill={tinta} />
            <circle cx={xFine} cy={y(ultimo)} r="4" fill={tinta} />
            <text x={xInizio - 10} y={y(primo) + 4} textAnchor="end" className="fill-text text-[11px]">
              {limitaTesto(voce.categoria)} · {formatta(primo, risultato.unita, true)}
            </text>
            <text x={xFine + 10} y={y(ultimo) + 4} className="fill-text text-[11px]">
              {formatta(ultimo, risultato.unita, true)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function quantile(valori: number[], posizione: number): number {
  const ordinati = [...valori].sort((a, b) => a - b);
  const indice = (ordinati.length - 1) * posizione;
  const inferiore = Math.floor(indice);
  const superiore = Math.ceil(indice);
  if (inferiore === superiore) return ordinati[inferiore];
  const peso = indice - inferiore;
  return ordinati[inferiore] * (1 - peso) + ordinati[superiore] * peso;
}

/** Riassume la distribuzione temporale di ogni categoria con quartili e outlier. */
export function Distribuzione({ risultato, altezza = 330, onClick }: ProprietaGraficoNuovo) {
  const { imp, colore, palette, durata } = useImpostazioni();
  if ((risultato.spec.raggruppa?.length ?? 0) !== 1 || !risultato.spec.granularita) {
    return <Vuoto altezza={altezza} testo="La distribuzione richiede un raggruppamento e una granularità temporale." />;
  }
  const categorie = seriePerCategoria(risultato)
    .map((voce) => ({ categoria: voce.categoria, valori: [...voce.valori.values()] }))
    .filter((voce) => voce.valori.length >= 2)
    .slice(0, imp.topN);
  if (categorie.length === 0) {
    return <Vuoto altezza={altezza} testo="Servono almeno due valori per categoria per calcolare la distribuzione." />;
  }
  const statistiche = categorie.map((voce) => {
    const q1 = quantile(voce.valori, 0.25);
    const mediana = quantile(voce.valori, 0.5);
    const q3 = quantile(voce.valori, 0.75);
    const intervallo = q3 - q1;
    const limiteBasso = q1 - intervallo * 1.5;
    const limiteAlto = q3 + intervallo * 1.5;
    const interni = voce.valori.filter((valore) => valore >= limiteBasso && valore <= limiteAlto);
    return {
      ...voce,
      q1,
      mediana,
      q3,
      basso: Math.min(...interni),
      alto: Math.max(...interni),
      anomali: voce.valori.filter((valore) => valore < limiteBasso || valore > limiteAlto),
    };
  });
  const tuttiValori = statistiche.flatMap((voce) => voce.valori);
  const minimo = Math.min(...tuttiValori);
  const massimo = Math.max(...tuttiValori);
  const y = (valore: number) => scalaLineare(valore, minimo, massimo, altezza - MARGINE.sotto, MARGINE.sopra);
  const spazio = (LARGHEZZA - MARGINE.sinistra - MARGINE.destra) / statistiche.length;
  const larghezzaScatola = Math.min(42, spazio * 0.55);

  return (
    <svg viewBox={`0 0 ${LARGHEZZA} ${altezza}`} className="h-auto w-full" role="img" aria-label="Grafico di distribuzione per categoria">
      <title>Distribuzione per categoria</title>
      {imp.mostraGriglia && [0, 0.5, 1].map((quota) => {
        const valore = minimo + (massimo - minimo) * quota;
        return <g key={quota}>
          <line x1={MARGINE.sinistra} x2={LARGHEZZA - MARGINE.destra} y1={y(valore)} y2={y(valore)} stroke={palette.neutro} strokeOpacity="0.25" />
          <text x={MARGINE.sinistra - 8} y={y(valore) + 4} textAnchor="end" className="fill-text-muted text-[10px]">{formatta(valore, risultato.unita, true)}</text>
        </g>;
      })}
      {statistiche.map((voce, indice) => {
        const x = MARGINE.sinistra + spazio * (indice + 0.5);
        const tinta = colore(indice);
        return <g
          key={voce.categoria}
          role={onClick ? "button" : undefined}
          tabIndex={onClick ? 0 : undefined}
          className={onClick ? "cursor-pointer outline-none" : undefined}
          onClick={() => onClick?.(voce.categoria)}
          onKeyDown={(evento) => gestisciTastiera(evento, onClick ? () => onClick(voce.categoria) : undefined)}
        >
          <line x1={x} x2={x} y1={y(voce.basso)} y2={y(voce.alto)} stroke={tinta} strokeWidth="2" />
          <line x1={x - 9} x2={x + 9} y1={y(voce.basso)} y2={y(voce.basso)} stroke={tinta} strokeWidth="2" />
          <line x1={x - 9} x2={x + 9} y1={y(voce.alto)} y2={y(voce.alto)} stroke={tinta} strokeWidth="2" />
          <rect x={x - larghezzaScatola / 2} y={y(voce.q3)} width={larghezzaScatola} height={Math.max(2, y(voce.q1) - y(voce.q3))} rx={imp.arrotondamento} fill={tinta} fillOpacity="0.22" stroke={tinta} style={{ transition: `all ${durata}ms ease-out` }} />
          <line x1={x - larghezzaScatola / 2} x2={x + larghezzaScatola / 2} y1={y(voce.mediana)} y2={y(voce.mediana)} stroke={tinta} strokeWidth="3" />
          {voce.anomali.map((valore, posizione) => <circle key={`${valore}-${posizione}`} cx={x} cy={y(valore)} r="3" fill={palette.negativo} />)}
          <text x={x} y={altezza - 18} textAnchor="middle" className="fill-text-muted text-[10px]">{limitaTesto(voce.categoria, 12)}</text>
        </g>;
      })}
    </svg>
  );
}

/** Bump chart: trasforma i valori in posizione relativa periodo per periodo. */
export function Posizioni({ risultato, altezza = 350, onClick }: ProprietaGraficoNuovo) {
  const { imp, colore, palette, durata } = useImpostazioni();
  const periodi = periodiDi(risultato);
  if ((risultato.spec.raggruppa?.length ?? 0) !== 1 || !risultato.spec.granularita) {
    return <Vuoto altezza={altezza} testo="Le posizioni richiedono un raggruppamento e una granularità temporale." />;
  }
  if (periodi.length < 3) {
    return <Vuoto altezza={altezza} testo="Le posizioni richiedono almeno tre periodi." />;
  }
  const tutte = seriePerCategoria(risultato);
  const categorie = [...tutte]
    .sort((a, b) => [...b.valori.values()].reduce((somma, valore) => somma + valore, 0) - [...a.valori.values()].reduce((somma, valore) => somma + valore, 0))
    .slice(0, imp.topN);
  if (categorie.length < 2) {
    return <Vuoto altezza={altezza} testo="Servono almeno due categorie per confrontare le posizioni." />;
  }
  const classifiche = periodi.map((periodo) => new Map(
    [...tutte]
      .sort((a, b) => (b.valori.get(periodo) ?? 0) - (a.valori.get(periodo) ?? 0))
      .map((voce, indice) => [voce.categoria, indice + 1])
  ));
  const x = (indice: number) => scalaLineare(indice, 0, periodi.length - 1, MARGINE.sinistra, LARGHEZZA - MARGINE.destra);
  const y = (posizione: number) => scalaLineare(posizione, 1, tutte.length, MARGINE.sopra, altezza - MARGINE.sotto);

  return (
    <svg viewBox={`0 0 ${LARGHEZZA} ${altezza}`} className="h-auto w-full" role="img" aria-label="Andamento delle posizioni nel tempo">
      <title>Classifica nel tempo</title>
      {periodi.map((periodo, indice) => <g key={periodo}>
        {imp.mostraGriglia && <line x1={x(indice)} x2={x(indice)} y1={MARGINE.sopra} y2={altezza - MARGINE.sotto} stroke={palette.neutro} strokeOpacity="0.25" />}
        <text x={x(indice)} y={altezza - 18} textAnchor="middle" className="fill-text-muted text-[10px]">{periodo}</text>
      </g>)}
      {categorie.map((voce, indice) => {
        const punti = periodi.map((_, posizione) => `${x(posizione)},${y(classifiche[posizione].get(voce.categoria) ?? tutte.length)}`).join(" ");
        const ultimaPosizione = classifiche[classifiche.length - 1].get(voce.categoria) ?? tutte.length;
        return <g
          key={voce.categoria}
          role={onClick ? "button" : undefined}
          tabIndex={onClick ? 0 : undefined}
          className={onClick ? "cursor-pointer outline-none" : undefined}
          onClick={() => onClick?.(voce.categoria)}
          onKeyDown={(evento) => gestisciTastiera(evento, onClick ? () => onClick(voce.categoria) : undefined)}
        >
          <polyline points={punti} fill="none" stroke={colore(indice)} strokeWidth="2.5" strokeLinejoin="round" style={{ transition: `all ${durata}ms ease-out` }} />
          {periodi.map((_, posizione) => {
            const rango = classifiche[posizione].get(voce.categoria) ?? tutte.length;
            return <circle key={posizione} cx={x(posizione)} cy={y(rango)} r="4.5" fill={colore(indice)}><title>{voce.categoria}: posizione {rango}</title></circle>;
          })}
          <text x={LARGHEZZA - MARGINE.destra + 9} y={y(ultimaPosizione) + 4} className="fill-text text-[10px]">{limitaTesto(voce.categoria, 15)}</text>
        </g>;
      })}
    </svg>
  );
}

/** Sankey lineare: ogni stadio conserva o perde parte del flusso precedente. */
export function Flusso({ risultato, altezza = 300, onClick }: ProprietaGraficoNuovo) {
  const { imp, colore, palette, durata } = useImpostazioni();
  const raggruppamenti = risultato.spec.raggruppa ?? [];
  const fasi = risultato.righe.slice(0, imp.topN);
  const decrescente = fasi.every((fase, indice) => indice === 0 || fase.valore <= fasi[indice - 1].valore);
  if (raggruppamenti.length !== 1 || risultato.spec.granularita) {
    return <Vuoto altezza={altezza} testo="Il flusso richiede un solo raggruppamento ordinato, senza asse temporale." />;
  }
  if (fasi.length < 2 || !decrescente || fasi.some((fase) => fase.valore < 0) || fasi[0]?.valore <= 0) {
    return <Vuoto altezza={altezza} testo="Il flusso richiede almeno due stadi con valori non negativi e decrescenti." />;
  }
  const larghezzaUtile = LARGHEZZA - MARGINE.sinistra - MARGINE.destra;
  const passo = larghezzaUtile / Math.max(fasi.length - 1, 1);
  const massimo = fasi[0].valore;
  const centroY = altezza / 2;
  const altezzaNodo = (valore: number) => Math.max(8, (valore / massimo) * Math.min(150, altezza - 100));
  const x = (indice: number) => MARGINE.sinistra + indice * passo;

  return (
    <svg viewBox={`0 0 ${LARGHEZZA} ${altezza}`} className="h-auto w-full" role="img" aria-label="Flusso tra stadi successivi">
      <title>Flusso tra stadi successivi</title>
      {fasi.slice(0, -1).map((fase, indice) => {
        const successiva = fasi[indice + 1];
        const altezzaPartenza = altezzaNodo(fase.valore);
        const altezzaArrivo = altezzaNodo(successiva.valore);
        const x1 = x(indice) + 12;
        const x2 = x(indice + 1) - 12;
        const controllo = (x2 - x1) * 0.45;
        const percorso = `M ${x1} ${centroY - altezzaPartenza / 2} C ${x1 + controllo} ${centroY - altezzaPartenza / 2}, ${x2 - controllo} ${centroY - altezzaArrivo / 2}, ${x2} ${centroY - altezzaArrivo / 2} L ${x2} ${centroY + altezzaArrivo / 2} C ${x2 - controllo} ${centroY + altezzaArrivo / 2}, ${x1 + controllo} ${centroY + altezzaPartenza / 2}, ${x1} ${centroY + altezzaPartenza / 2} Z`;
        return <path key={fase.etichetta} d={percorso} fill={colore(indice)} fillOpacity={imp.gradienti ? 0.32 : 0.48} style={{ transition: `all ${durata}ms ease-out` }} />;
      })}
      {fasi.map((fase, indice) => {
        const altezzaFase = altezzaNodo(fase.valore);
        const conversione = indice === 0 ? 100 : (fase.valore / fasi[indice - 1].valore) * 100;
        return <g
          key={fase.etichetta}
          role={onClick ? "button" : undefined}
          tabIndex={onClick ? 0 : undefined}
          className={onClick ? "cursor-pointer outline-none" : undefined}
          onClick={() => onClick?.(fase.etichetta)}
          onKeyDown={(evento) => gestisciTastiera(evento, onClick ? () => onClick(fase.etichetta) : undefined)}
        >
          <rect x={x(indice) - 12} y={centroY - altezzaFase / 2} width="24" height={altezzaFase} rx={Math.min(imp.arrotondamento, 6)} fill={colore(indice)} />
          <text x={x(indice)} y={centroY - altezzaFase / 2 - 20} textAnchor="middle" className="fill-text text-[11px] font-semibold">{limitaTesto(fase.etichetta, 14)}</text>
          <text x={x(indice)} y={centroY - altezzaFase / 2 - 7} textAnchor="middle" className="fill-text-muted text-[10px]">{formatta(fase.valore, risultato.unita, true)}</text>
          {indice > 0 && <text x={x(indice)} y={centroY + altezzaFase / 2 + 18} textAnchor="middle" fill={palette.neutro} className="text-[10px]">{conversione.toFixed(1)}%</text>}
        </g>;
      })}
    </svg>
  );
}

/** Frequenze dei valori osservati, suddivise in fasce calcolate. */
export function Istogramma({ risultato, altezza = 300 }: ProprietaGraficoNuovo) {
  const { imp, colore, palette, durata } = useImpostazioni();
  const valori = risultato.righe.map((riga) => riga.valore).filter(Number.isFinite);
  if (valori.length < 2) {
    return <Vuoto altezza={altezza} testo="L’istogramma richiede almeno due valori." />;
  }
  const minimo = Math.min(...valori);
  const massimo = Math.max(...valori);
  const numeroFasce = minimo === massimo ? 1 : Math.min(12, Math.max(3, Math.ceil(Math.sqrt(valori.length))));
  const ampiezza = numeroFasce === 1 ? 1 : (massimo - minimo) / numeroFasce;
  const frequenze = Array.from({ length: numeroFasce }, () => 0);
  for (const valore of valori) {
    const indice = numeroFasce === 1 ? 0 : Math.min(numeroFasce - 1, Math.floor((valore - minimo) / ampiezza));
    frequenze[indice] += 1;
  }
  const massimoFrequenza = Math.max(...frequenze, 1);
  const larghezzaUtile = LARGHEZZA - MARGINE.sinistra - MARGINE.destra;
  const altezzaUtile = altezza - MARGINE.sopra - MARGINE.sotto;
  const larghezzaBarra = larghezzaUtile / numeroFasce;

  return (
    <svg viewBox={`0 0 ${LARGHEZZA} ${altezza}`} className="h-auto w-full" role="img" aria-label="Istogramma delle frequenze">
      <title>Distribuzione delle frequenze</title>
      {imp.mostraGriglia && [0, 0.5, 1].map((quota) => {
        const y = MARGINE.sopra + altezzaUtile * (1 - quota);
        return <g key={quota}>
          <line x1={MARGINE.sinistra} x2={LARGHEZZA - MARGINE.destra} y1={y} y2={y} stroke={palette.neutro} strokeOpacity="0.25" />
          <text x={MARGINE.sinistra - 8} y={y + 4} textAnchor="end" className="fill-text-muted text-[10px]">{Math.round(massimoFrequenza * quota)}</text>
        </g>;
      })}
      {frequenze.map((frequenza, indice) => {
        const altezzaBarra = (frequenza / massimoFrequenza) * altezzaUtile;
        const inizio = minimo + indice * ampiezza;
        const fine = numeroFasce === 1 ? massimo : inizio + ampiezza;
        return <g key={indice}>
          <rect
            x={MARGINE.sinistra + indice * larghezzaBarra + 1}
            y={MARGINE.sopra + altezzaUtile - altezzaBarra}
            width={Math.max(1, larghezzaBarra - 2)}
            height={altezzaBarra}
            rx={Math.min(imp.arrotondamento, 4)}
            fill={colore(0)}
            style={{ transition: `all ${durata}ms ease-out` }}
          >
            <title>{formatta(inizio, risultato.unita, false)} – {formatta(fine, risultato.unita, false)}: {frequenza} righe</title>
          </rect>
          <text x={MARGINE.sinistra + (indice + 0.5) * larghezzaBarra} y={altezza - 18} textAnchor="middle" className="fill-text-muted text-[9px]">
            {formatta(inizio, risultato.unita, true)}
          </text>
        </g>;
      })}
      <text x={LARGHEZZA - MARGINE.destra} y={altezza - 18} textAnchor="end" className="fill-text-muted text-[9px]">{formatta(massimo, risultato.unita, true)}</text>
    </svg>
  );
}
