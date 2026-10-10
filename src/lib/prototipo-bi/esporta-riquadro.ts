/**
 * ESPORTAZIONE IN EXCEL DI UN RIQUADRO.
 *
 * Quello che si vede nel grafico, in un foglio: una riga per voce, una colonna
 * per ciascuna dimensione di raggruppamento e una per ciascuna misura. Come
 * l'«Esporta dati» di Power BI, serve a chi vuole filtrare, ordinare o
 * incrociare i numeri in un foglio proprio: ad esempio per scegliere la data di
 * consegna, che il filtro complessivo della pagina non conosce.
 *
 * Si esporta il risultato GIA' calcolato dal riquadro (stessi filtri della
 * pagina, stesso periodo, stesso perimetro di chi guarda): niente nuovo
 * calcolo e niente viaggio di rete, quindi il foglio non puo' dire cose diverse
 * dal grafico.
 *
 * Il foglio si compone qui, in una funzione pura che si prova senza browser; la
 * scrittura del file (libreria xlsx, pesante) sta in `scriviExcelRiquadro`,
 * caricata solo al clic.
 */

import { CATALOGO, DIMENSIONI } from "./semantico";
import type { Filtro, Periodo, SerieAnalisiEseguita, SpecQuery, UnitaMisura } from "./tipi";

export type CellaExcel = string | number | null;

export interface FoglioDati {
  colonne: string[];
  righe: CellaExcel[][];
}

export interface EsportazioneRiquadro {
  nomeFile: string;
  dati: FoglioDati;
  /** Un foglio «Informazioni»: da dove vengono i numeri. */
  informazioni: CellaExcel[][];
}

const SUFFISSO_UNITA: Record<UnitaMisura, string> = {
  euro: " (€)",
  percentuale: " (%)",
  giorni: " (giorni)",
  numero: "",
};

function nomeDimensione(chiave: string): string {
  if (chiave === "periodo") return "Periodo";
  return (DIMENSIONI as Record<string, { etichetta: string }>)[chiave]?.etichetta ?? chiave;
}

/** Nomi di colonna distinti: due misure con lo stesso nome non devono sovrapporsi. */
function nomiColonneMisure(serie: SerieAnalisiEseguita[]): string[] {
  const usati = new Map<string, number>();
  return serie.map((s) => {
    const base = `${s.nome || CATALOGO[s.risultato.metrica]?.etichetta || s.risultato.metrica}${SUFFISSO_UNITA[s.risultato.unita] ?? ""}`;
    const volte = (usati.get(base) ?? 0) + 1;
    usati.set(base, volte);
    return volte === 1 ? base : `${base} (${volte})`;
  });
}

/**
 * Le colonne di suddivisione: il periodo (se c'e' una granularita') e poi le
 * dimensioni nell'ordine in cui sono state scelte, unite fra tutte le serie.
 */
function colonneDimensione(serie: SerieAnalisiEseguita[]): string[] {
  const ordine: string[] = [];
  const aggiungi = (chiave: string) => {
    if (!ordine.includes(chiave)) ordine.push(chiave);
  };
  for (const s of serie) {
    if (s.spec.granularita) aggiungi("periodo");
    for (const d of s.spec.raggruppa ?? []) aggiungi(d);
  }
  return ordine;
}

/** La tabella dati: una riga per voce, unendo le serie sulla stessa etichetta. */
export function tabellaDaSerie(serie: SerieAnalisiEseguita[]): FoglioDati {
  const dimensioni = colonneDimensione(serie);
  const misure = nomiColonneMisure(serie);

  // L'ordine delle voci e' quello della prima serie; le voci che esistono solo
  // nelle altre si accodano, cosi' nessun numero si perde.
  const voci = new Map<string, { chiavi: Record<string, string>; valori: (number | null)[] }>();
  serie.forEach((s, indice) => {
    for (const r of s.risultato.righe) {
      const esistente = voci.get(r.etichetta) ?? {
        chiavi: r.chiavi,
        valori: serie.map(() => null as number | null),
      };
      esistente.valori[indice] = r.valore;
      voci.set(r.etichetta, esistente);
    }
  });

  const righe: CellaExcel[][] = [...voci.entries()].map(([etichetta, voce]) => {
    // Senza dimensioni (un totale solo) la colonna «Voce» dice almeno cos'e'.
    const celleDimensione = dimensioni.length > 0 ? dimensioni.map((d) => voce.chiavi[d] ?? "") : [etichetta];
    return [...celleDimensione, ...voce.valori];
  });

  const colonne = [...(dimensioni.length > 0 ? dimensioni.map(nomeDimensione) : ["Voce"]), ...misure];
  return { colonne, righe };
}

function testoFiltro(f: Filtro): string {
  const valore = Array.isArray(f.valore) ? f.valore.join(", ") : f.valore;
  const operatore = { eq: "=", neq: "≠", in: "in", contiene: "contiene" }[f.op] ?? f.op;
  return `${nomeDimensione(f.campo)} ${operatore} ${valore}`;
}

function testoPeriodo(p: Periodo | undefined): string {
  if (!p) return "Quello della pagina";
  const parti: string[] = [];
  if (p.anni?.length) parti.push(`anni ${p.anni.join(", ")}`);
  else if (p.anno) parti.push(`anno ${p.anno}`);
  if (p.dal || p.al) parti.push(`${p.dal ?? "…"} → ${p.al ?? "…"}`);
  return parti.join(" · ") || "Quello della pagina";
}

function nomeFileSicuro(titolo: string, oggi: string): string {
  const pulito = titolo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `BI_${pulito || "riquadro"}_${oggi}.xlsx`;
}

export function preparaEsportazione(titolo: string, serie: SerieAnalisiEseguita[], oggi: string = new Date().toISOString().slice(0, 10)): EsportazioneRiquadro {
  const informazioni: CellaExcel[][] = [
    ["Riquadro", titolo],
    ["Estratto il", oggi],
    [],
    ["Misura", "Che cosa conta", "Totale", "Periodo", "Filtri"],
  ];
  const nomi = nomiColonneMisure(serie);
  serie.forEach((s, i) => {
    const spec: SpecQuery = s.spec;
    const def = CATALOGO[s.risultato.metrica];
    informazioni.push([
      nomi[i],
      spec.misura ? `Misura personalizzata «${spec.misura.nome}»` : (def?.descrizione ?? ""),
      s.risultato.totale,
      testoPeriodo(spec.periodo),
      (spec.filtri ?? []).map(testoFiltro).join(" · ") || "nessuno",
    ]);
  });
  const avvisi = [...new Set(serie.flatMap((s) => s.risultato.avvisi ?? []))];
  if (avvisi.length > 0) {
    informazioni.push([], ["Avvisi"]);
    for (const a of avvisi) informazioni.push([a]);
  }
  return { nomeFile: nomeFileSicuro(titolo, oggi), dati: tabellaDaSerie(serie), informazioni };
}

/** Scrive il file e lo fa scaricare. La libreria xlsx si carica solo qui. */
export async function scriviExcelRiquadro(esportazione: EsportazioneRiquadro): Promise<void> {
  const XLSX = await import("xlsx");
  const foglio = XLSX.utils.aoa_to_sheet([esportazione.dati.colonne, ...esportazione.dati.righe]);
  foglio["!cols"] = esportazione.dati.colonne.map((c) => ({ wch: Math.min(Math.max(c.length + 2, 12), 48) }));
  const info = XLSX.utils.aoa_to_sheet(esportazione.informazioni);
  info["!cols"] = [{ wch: 28 }, { wch: 60 }, { wch: 16 }, { wch: 24 }, { wch: 60 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, foglio, "Dati");
  XLSX.utils.book_append_sheet(libro, info, "Informazioni");
  XLSX.writeFile(libro, esportazione.nomeFile);
}
