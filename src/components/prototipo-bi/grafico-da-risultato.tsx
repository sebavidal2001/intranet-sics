"use client";

import { CATALOGO, DIMENSIONI } from "@/lib/prototipo-bi/semantico";
import { etichettaDocumento, famigliaDellaMetrica } from "@/lib/prototipo-bi/albero-modello";
import { formattaPeriodo } from "@/lib/prototipo-bi/formato-periodo";
import type {
  AspettoGrafico,
  DifferenzaTabella,
  RisultatoQuery,
  RigaRisultato,
  SerieAnalisiEseguita,
  UnitaMisura,
} from "@/lib/prototipo-bi/tipi";
import {
  graficiPossibili,
  scegliGrafico,
  type TipoGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import {
  GraficoBarre,
  GraficoCombo,
  GraficoLinee,
  GraficoTorta,
  KpiEroe,
  PALETTE,
  Vuoto,
} from "./primitivi";
import {
  BarreScostamento,
  Bullet,
  Heatmap,
  Pareto,
  Quadranti,
  Sparkline,
} from "./grafici-avanzati";
import { Anelli, AreeImpilate, CalendarioAttivita, Composizione, Imbuto } from "./grafici-spettacolari";
import {
  Distribuzione,
  Flusso,
  Istogramma,
  Matrice,
  Pendenza,
  Posizioni,
} from "./grafici-nuovi";
import { AspettoLocale, useImpostazioni } from "./impostazioni";
import { BarreImpilate, datiBarreImpilate } from "./barre-impilate";
import { MappaVisite } from "./mappa-visite";
import {
  COLONNA_VOCE,
  TabellaAnalitica,
  type ColonnaAnalitica,
  type RigaAnalitica,
} from "./tabella-analitica";

interface ProprietaGraficoDaRisultato {
  risultato: RisultatoQuery;
  tipo?: TipoGrafico;
  altezza?: number;
  coloreSerie?: string;
  onClickEtichetta?: (etichetta: string) => void;
}

interface ProprietaGraficoDaAnalisi {
  serie: SerieAnalisiEseguita[];
  tipo?: TipoGrafico;
  altezza?: number;
  /** Colori, legenda, assi e totali scelti per questo riquadro. */
  aspetto?: AspettoGrafico | null;
  onClickEtichetta?: (etichetta: string) => void;
}

function totaleAutomatico(unita: UnitaMisura): ColonnaAnalitica["totale"] {
  // Percentuali e giorni sono medie o rapporti: sommarli darebbe un numero
  // mai misurato. Meglio la cella vuota, oppure la scelta esplicita
  // dell'utente nella tendina dei totali.
  return unita === "percentuale" || unita === "giorni" ? { tipo: "nessuno" } : { tipo: "somma" };
}

/**
 * Il nome di una colonna di campo. Il numero del documento prende il nome della
 * sua operazione («Numero ordine», «Numero fattura»): «Documento» non dice quale.
 */
function nomeColonnaCampo(dimensione: keyof typeof DIMENSIONI, metrica: keyof typeof CATALOGO): string {
  if (dimensione === "documento" || dimensione === "documento_anno") {
    const proprio = etichettaDocumento(famigliaDellaMetrica(metrica));
    // «Numero ordine/anno» per il numero con l'anno, «Numero ordine» per quello nudo.
    if (proprio) return dimensione === "documento_anno" ? proprio : proprio.replace(/\/anno$/, "");
  }
  return DIMENSIONI[dimensione]?.etichetta ?? dimensione;
}

/** Il nome della colonna del tempo, secondo la granularita' scelta. */
const NOME_COLONNA_TEMPO: Record<string, string> = {
  giorno: "Data",
  settimana: "Settimana",
  mese: "Mese",
  anno: "Anno",
};

/**
 * La tabella di un risultato solo.
 *
 * Una riga per ogni combinazione e una colonna per ogni valore: data, cliente,
 * agente, e in fondo la misura. Prima le suddivisioni venivano unite in una
 * sola «Voce» («2026-10-05 · PELLICONI · BATTELANI») e, con tempo piu' una
 * suddivisione, anche incrociate in colonne: leggibile per un riepilogo, ma
 * non per chi vuole ordinare o cercare per cliente o per data. Le date si
 * scrivono gg/mm/aaaa.
 */
function datiTabellaRisultato(risultato: RisultatoQuery): {
  colonne: ColonnaAnalitica[];
  righe: RigaAnalitica[];
  intestazione: string;
  temporale: boolean;
  senzaVoce: boolean;
  colonnaOrdinamento?: string;
} {
  const dimensioni = risultato.spec.raggruppa ?? [];
  const granularita = risultato.spec.granularita;
  const temporale = granularita !== undefined;
  const tipo = tipoColonna(risultato.unita);
  const nomeMisura =
    risultato.spec.misura?.nome ?? CATALOGO[risultato.metrica]?.etichetta ?? "Valore";

  const colonneValore: ColonnaAnalitica[] = [
    {
      chiave: "valore",
      etichetta: nomeMisura,
      tipo: tipo === "euro" ? "barra" : tipo,
      unita: risultato.unita,
      totale: totaleAutomatico(risultato.unita),
    },
  ];

  // Senza suddivisioni e senza tempo c'e' un numero solo: niente da scomporre.
  if (!temporale && dimensioni.length === 0) {
    return {
      colonne: colonneValore,
      righe: risultato.righe.map((riga) => ({ chiave: riga.etichetta, celle: { valore: riga.valore } })),
      intestazione: "Voce",
      temporale,
      senzaVoce: false,
    };
  }

  const colonneDimensione: ColonnaAnalitica[] = [
    ...(temporale
      ? [
          {
            chiave: "d_periodo",
            etichetta: NOME_COLONNA_TEMPO[granularita] ?? "Periodo",
            tipo: "testo" as const,
            formatta: formattaPeriodo,
          },
        ]
      : []),
    ...dimensioni.map((dimensione) => ({
      chiave: `d_${dimensione}`,
      etichetta: nomeColonnaCampo(dimensione, risultato.metrica),
      tipo: "testo" as const,
      formatta: formattaPeriodo,
    })),
  ];

  return {
    colonne: [...colonneDimensione, ...colonneValore],
    righe: risultato.righe.map((riga) => {
      const celle: RigaAnalitica["celle"] = { valore: riga.valore };
      if (temporale) celle.d_periodo = riga.chiavi.periodo ?? "";
      for (const dimensione of dimensioni) celle[`d_${dimensione}`] = riga.chiavi[dimensione] ?? "";
      return { chiave: riga.etichetta, celle };
    }),
    intestazione: "Voce",
    temporale,
    senzaVoce: true,
    // Nel tempo si legge in ordine cronologico.
    colonnaOrdinamento: temporale ? "d_periodo" : undefined,
  };
}

function TabellaRisultato({
  risultato,
  onClickRiga,
}: {
  risultato: RisultatoQuery;
  onClickRiga?: (etichetta: string) => void;
}) {
  const { aspetto } = useImpostazioni();
  if (risultato.righe.length === 0) return <Vuoto altezza={140} />;
  const dati = datiTabellaRisultato(risultato);
  return (
    <TabellaAnalitica
      colonne={dati.colonne}
      righe={dati.righe}
      colonnaDimensione={dati.intestazione}
      senzaColonnaVoce={dati.senzaVoce}
      // Un ordinamento scelto nel riquadro prevale su quello cronologico.
      colonnaOrdinamentoIniziale={aspetto?.tabella?.ordinaPer ? undefined : dati.colonnaOrdinamento}
      massimoIniziale={15}
      onClickRiga={onClickRiga}
    />
  );
}

function datiSemplici(risultato: RisultatoQuery) {
  return risultato.righe.map(({ etichetta, valore }) => ({ etichetta, valore }));
}

function risultatoPerSerie(
  risultato: RisultatoQuery,
  righe: RigaRisultato[]
): RisultatoQuery {
  return {
    ...risultato,
    righe,
    totale: righe.reduce((somma, riga) => somma + riga.valore, 0),
  };
}

/** Il nome da mostrare: quello della misura personalizzata, o la chiave della metrica. */
function nomeDelRisultato(risultato: RisultatoQuery): string {
  return risultato.spec.misura?.nome ?? risultato.metrica;
}

function serieTemporali(risultato: RisultatoQuery): { nome: string; risultato: RisultatoQuery }[] {
  const dimensione = risultato.spec.raggruppa?.[0];
  if (!dimensione) return [{ nome: nomeDelRisultato(risultato), risultato }];

  const totali = new Map<string, number>();
  for (const riga of risultato.righe) {
    const categoria = riga.chiavi[dimensione];
    totali.set(categoria, (totali.get(categoria) ?? 0) + riga.valore);
  }
  const categorie = [...totali.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([categoria]) => categoria);

  return categorie.map((categoria) => ({
    nome: categoria,
    risultato: risultatoPerSerie(
      risultato,
      risultato.righe
        .filter((riga) => riga.chiavi[dimensione] === categoria)
        .map((riga) => ({ ...riga, etichetta: riga.chiavi.periodo }))
    ),
  }));
}

function matrice(risultato: RisultatoQuery) {
  const dimensioni = risultato.spec.raggruppa ?? [];
  const chiaveRiga = dimensioni[0];
  const chiaveColonna = dimensioni[1] ?? (risultato.spec.granularita ? "periodo" : undefined);
  if (!chiaveRiga || !chiaveColonna) return null;

  const righe = [...new Set(risultato.righe.map((riga) => riga.chiavi[chiaveRiga]))];
  const colonne = [...new Set(risultato.righe.map((riga) => riga.chiavi[chiaveColonna]))];
  const valori: Record<string, Record<string, number>> = {};
  for (const riga of risultato.righe) {
    const nomeRiga = riga.chiavi[chiaveRiga];
    const nomeColonna = riga.chiavi[chiaveColonna];
    valori[nomeRiga] ??= {};
    valori[nomeRiga][nomeColonna] = (valori[nomeRiga][nomeColonna] ?? 0) + riga.valore;
  }
  return { righe, colonne, valori };
}

/** Oltre questo numero di categorie le aree impilate diventano illeggibili. */
const MASSIMO_AREE = 6;

function aree(risultato: RisultatoQuery) {
  const dimensione = risultato.spec.raggruppa?.[0];
  if (!dimensione || !risultato.spec.granularita) return null;

  const periodi = [...new Set(risultato.righe.map((riga) => riga.chiavi.periodo))].sort();
  const totali = new Map<string, number>();
  for (const riga of risultato.righe) {
    const c = riga.chiavi[dimensione];
    totali.set(c, (totali.get(c) ?? 0) + Math.abs(riga.valore));
  }
  // Le categorie oltre la sesta per peso si sommano in «Altri»: prima il
  // grafico veniva rifiutato del tutto appena c'era un addetto in piu' (il
  // Back office ne ha sette) e al suo posto compariva una tabella lunghissima.
  const ordinate = [...totali.keys()].sort((a, b) => (totali.get(b) ?? 0) - (totali.get(a) ?? 0));
  const tenute = new Set(
    ordinate.length > MASSIMO_AREE ? ordinate.slice(0, MASSIMO_AREE - 1) : ordinate
  );
  const nomi = [...ordinate.filter((c) => tenute.has(c)), ...(ordinate.length > tenute.size ? ["Altri"] : [])];
  const serie = nomi.map((nome) => {
    const valori: Record<string, number> = {};
    for (const riga of risultato.righe) {
      const categoria = riga.chiavi[dimensione];
      const destinazione = tenute.has(categoria) ? categoria : "Altri";
      if (destinazione === nome) {
        const periodo = riga.chiavi.periodo;
        valori[periodo] = (valori[periodo] ?? 0) + riga.valore;
      }
    }
    return { nome, valori };
  });
  return { periodi, serie };
}

/**
 * Serie giornaliera senza suddivisioni: la «heatmap» giusta e' il calendario,
 * una casella per giorno. Si disegna l'anno dell'ultimo giorno presente.
 */
function calendario(risultato: RisultatoQuery) {
  if (risultato.spec.granularita !== "giorno" || (risultato.spec.raggruppa?.length ?? 0) > 0) return null;
  const valori: Record<string, number> = {};
  let ultimo = "";
  for (const riga of risultato.righe) {
    const giorno = riga.chiavi.periodo ?? riga.etichetta;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) continue;
    valori[giorno] = (valori[giorno] ?? 0) + riga.valore;
    if (giorno > ultimo) ultimo = giorno;
  }
  if (!ultimo) return null;
  return { valori, anno: Number(ultimo.slice(0, 4)) };
}

function valorePerEtichetta(risultato: RisultatoQuery): Map<string, number> {
  return new Map(risultato.righe.map((riga) => [riga.etichetta, riga.valore]));
}

function risultatoAllineatoNelTempo(voce: SerieAnalisiEseguita): RisultatoQuery {
  if (voce.spec.modificatore !== "anno_precedente" && voce.spec.modificatore !== "progressivo_ap") {
    return voce.risultato;
  }
  return {
    ...voce.risultato,
    righe: voce.risultato.righe.map((riga) => {
      const periodo = riga.chiavi.periodo;
      if (!/^\d{4}(?:-|$)/u.test(periodo ?? "")) return riga;
      const allineato = `${Number(periodo.slice(0, 4)) + 1}${periodo.slice(4)}`;
      return {
        ...riga,
        etichetta: riga.etichetta.replace(periodo, allineato),
        chiavi: { ...riga.chiavi, periodo: allineato },
      };
    }),
  };
}

function righeBullet(serie: SerieAnalisiEseguita[]) {
  const principale = serie.find((voce) => voce.ruolo === "principale");
  const obiettivo = serie.find((voce) => voce.ruolo === "obiettivo");
  const soglia = serie.find((voce) => voce.ruolo === "soglia");
  if (!principale || !obiettivo) return [];

  if (
    principale.risultato.righe.length === 1 &&
    (principale.risultato.spec.raggruppa?.length ?? 0) === 0
  ) {
    return [{
      etichetta: principale.nome,
      valore: principale.risultato.totale,
      obiettivo: obiettivo.risultato.totale,
      soglia: soglia?.risultato.totale,
    }];
  }

  const obiettivi = valorePerEtichetta(obiettivo.risultato);
  const soglie = soglia ? valorePerEtichetta(soglia.risultato) : new Map<string, number>();
  return principale.risultato.righe.map((riga) => ({
    etichetta: riga.etichetta,
    valore: riga.valore,
    obiettivo: obiettivi.get(riga.etichetta) ?? 0,
    soglia: soglie.get(riga.etichetta),
  }));
}

function tipoColonna(unita: UnitaMisura): ColonnaAnalitica["tipo"] {
  if (unita === "percentuale") return "percentuale";
  if (unita === "euro") return "euro";
  return "numero";
}

/**
 * Le differenze da mostrare in tabella.
 *
 * Se l'utente le ha scelte (anche «nessuna») valgono quelle e basta. Altrimenti
 * resta il comportamento storico: una misura con ruolo «confronto» produce da
 * sola una differenza rispetto alla principale. Tenerlo evita di cambiare i
 * riquadri gia' salvati; la scelta esplicita lo sostituisce.
 */
function differenzeEffettive(
  serie: SerieAnalisiEseguita[],
  principale: SerieAnalisiEseguita,
  scelte: DifferenzaTabella[] | undefined
): { elenco: DifferenzaTabella[]; storico: boolean } {
  if (scelte !== undefined) return { elenco: scelte, storico: false };
  const iPrincipale = serie.indexOf(principale);
  // Solo se il confronto e' nella stessa unita': la differenza fra «Ordinato» e
  // «Numero ordini» mescolerebbe euro e ordini, e comparirebbe da sola ogni
  // volta che si aggiunge una misura in una tabella.
  const stessaUnita = (voce: SerieAnalisiEseguita) => voce.risultato.unita === principale.risultato.unita;
  const iConfronto = serie.findIndex((voce) => voce.ruolo === "confronto" && stessaUnita(voce));
  return {
    elenco:
      iConfronto >= 0 && iConfronto !== iPrincipale
        ? [{ da: iPrincipale, con: iConfronto, modo: "assoluta" }]
        : [],
    storico: true,
  };
}

/**
 * Colonne e celle delle differenze.
 *
 * `colonnaDi` traduce una misura nella posizione della sua colonna `serie_N`
 * (-1 se in questa tabella non c'e', per esempio una misura nel tempo dentro
 * una tabella senza periodi): quella differenza semplicemente non si mostra.
 */
function costruisciDifferenze(
  serie: SerieAnalisiEseguita[],
  decise: { elenco: DifferenzaTabella[]; storico: boolean },
  colonnaDi: (voce: SerieAnalisiEseguita) => number,
  unita: UnitaMisura,
  etichettaStorica: (confronto: SerieAnalisiEseguita) => string
): {
  colonne: ColonnaAnalitica[];
  celle: (valore: (colonna: number) => number) => Record<string, number | null>;
} {
  const voci = decise.elenco.flatMap((d, k) => {
    const vDa = serie[d.da];
    const vCon = serie[d.con];
    if (!vDa || !vCon || vDa === vCon) return [];
    const a = colonnaDi(vDa);
    const b = colonnaDi(vCon);
    return a < 0 || b < 0 ? [] : [{ k, a, b, vDa, vCon, percentuale: d.modo === "percentuale" }];
  });

  const colonne = voci.map((v): ColonnaAnalitica => {
    if (v.percentuale) {
      return {
        chiave: `diff_${v.k}`,
        etichetta: `Δ% ${v.vDa.nome} su ${v.vCon.nome}`,
        tipo: "delta_pct",
        // Il totale e' il rapporto fra le somme, non la media delle percentuali.
        totale: { tipo: "rapporto", numeratore: `_diff_${v.k}`, denominatore: `serie_${v.b}` },
      };
    }
    return {
      chiave: decise.storico ? "delta_confronto" : `diff_${v.k}`,
      etichetta: decise.storico ? etichettaStorica(v.vCon) : `Δ ${v.vDa.nome} − ${v.vCon.nome}`,
      tipo: unita === "euro" ? "delta_euro" : "numero",
      unita,
      totale: totaleAutomatico(unita),
    };
  });

  return {
    colonne,
    celle: (valore) => {
      const celle: Record<string, number | null> = {};
      for (const v of voci) {
        const differenza = valore(v.a) - valore(v.b);
        if (v.percentuale) {
          const base = valore(v.b);
          celle[`diff_${v.k}`] = base === 0 ? null : (differenza / Math.abs(base)) * 100;
          celle[`_diff_${v.k}`] = differenza;
        } else {
          celle[decise.storico ? "delta_confronto" : `diff_${v.k}`] = differenza;
        }
      }
      return celle;
    },
  };
}

function chiaveCategoria(serie: SerieAnalisiEseguita, riga: RigaRisultato): string {
  const dimensione = serie.spec.raggruppa?.[0];
  return dimensione ? riga.chiavi[dimensione] ?? riga.etichetta : riga.etichetta;
}

/**
 * Cio' che identifica una riga della tabella, uguale per tutte le misure.
 *
 * Con una dimensione e' il suo valore. Con due o piu' servono tutte: la sola
 * prima fondeva righe diverse (due agenti dello stesso cliente) in una, e le
 * misure si sovrascrivevano a vicenda.
 */
function chiaveRiga(serie: SerieAnalisiEseguita, riga: RigaRisultato): string {
  const dimensioni = serie.spec.raggruppa ?? [];
  if (dimensioni.length <= 1) return chiaveCategoria(serie, riga);
  return dimensioni.map((dimensione) => riga.chiavi[dimensione] ?? "").join(" · ");
}

/** Le colonne di testo della tabella: il tempo (se c'e') e un campo per ogni dimensione. */
function colonneDeiCampi(principale: SerieAnalisiEseguita): ColonnaAnalitica[] {
  const dimensioni = principale.spec.raggruppa ?? [];
  const granularita = principale.spec.granularita;
  return [
    ...(granularita !== undefined
      ? [
          {
            chiave: "d_periodo",
            etichetta: NOME_COLONNA_TEMPO[granularita] ?? "Periodo",
            tipo: "testo" as const,
            formatta: formattaPeriodo,
          },
        ]
      : []),
    ...dimensioni.map((dimensione) => ({
      chiave: `d_${dimensione}`,
      etichetta: nomeColonnaCampo(dimensione, principale.risultato.metrica),
      tipo: "testo" as const,
      formatta: formattaPeriodo,
    })),
  ];
}

/** I valori dei campi di una riga, nelle colonne di `colonneDeiCampi`. */
function celleDeiCampi(
  principale: SerieAnalisiEseguita,
  chiavi: RigaRisultato["chiavi"] | undefined
): RigaAnalitica["celle"] {
  const celle: RigaAnalitica["celle"] = {};
  if (principale.spec.granularita !== undefined) celle.d_periodo = chiavi?.periodo ?? "";
  for (const dimensione of principale.spec.raggruppa ?? []) celle[`d_${dimensione}`] = chiavi?.[dimensione] ?? "";
  return celle;
}

/**
 * La tabella di più misure insieme (ordinato, budget, BEP, anno precedente…).
 *
 * Con misure nel tempo le righe sono i periodi — o periodo e categoria — e
 * ogni misura una colonna. Prima qui entravano come colonne solo le misure
 * SENZA granularità: scegliendo la tabella per «ordinato e budget per mese»
 * restava una tabella senza numeri, o tutto schiacciato sulla categoria, e le
 * settimane e i mesi sparivano.
 */
function tabellaComposita(serie: SerieAnalisiEseguita[], scelte?: DifferenzaTabella[]): {
  colonne: ColonnaAnalitica[];
  righe: RigaAnalitica[];
  temporale: boolean;
  /** Vero se ogni campo ha la sua colonna e non c'e' la «Voce» concatenata. */
  senzaVoce: boolean;
} {
  const principale = serie.find((voce) => voce.ruolo === "principale") ?? serie[0];
  if (!principale) return { colonne: [], righe: [], temporale: false, senzaVoce: false };
  if (principale.spec.granularita !== undefined) return tabellaCompositaNelTempo(serie, principale, scelte);
  const nonTemporali = serie.filter((voce) => voce.spec.granularita === undefined);
  const fontiRighe = nonTemporali.length > 0 ? nonTemporali : [principale];
  const chiavi = new Set<string>();
  // I valori dei campi di ogni riga, per le colonne di testo.
  const campiDellaRiga = new Map<string, RigaRisultato["chiavi"]>();
  for (const voce of fontiRighe) {
    for (const riga of voce.risultato.righe) {
      const chiave = chiaveRiga(voce, riga);
      chiavi.add(chiave);
      if (!campiDellaRiga.has(chiave)) campiDellaRiga.set(chiave, riga.chiavi);
    }
  }
  // Una colonna per ogni campo, come nella tabella di un risultato solo.
  const senzaVoce = (principale.spec.raggruppa?.length ?? 0) > 0;
  const colonneCampi = senzaVoce ? colonneDeiCampi(principale) : [];

  const colonne: ColonnaAnalitica[] = nonTemporali.map((voce, indice) => ({
    chiave: `serie_${indice}`,
    etichetta: voce.nome,
    tipo: indice === 0 ? "barra" : tipoColonna(voce.risultato.unita),
    unita: voce.risultato.unita,
  }));
  const obiettivo = nonTemporali.find((voce) => voce.ruolo === "obiettivo");
  const differenze = costruisciDifferenze(
    serie,
    differenzeEffettive(serie, principale, scelte),
    (voce) => nonTemporali.indexOf(voce),
    principale.risultato.unita,
    () => "Delta"
  );
  colonne.push(...differenze.colonne);
  if (obiettivo) {
    colonne.push({
      chiave: "raggiungimento",
      etichetta: "Raggiungimento",
      tipo: "raggiungimento",
    });
  }
  const temporale = serie.find(
    (voce) => voce.spec.granularita !== undefined && (voce.spec.raggruppa?.length ?? 0) > 0
  );
  if (temporale) {
    colonne.push({ chiave: "andamento", etichetta: "Andamento", tipo: "sparkline" });
  }

  const mappe = new Map<SerieAnalisiEseguita, Map<string, number>>();
  for (const voce of nonTemporali) {
    mappe.set(
      voce,
      new Map(voce.risultato.righe.map((riga) => [chiaveRiga(voce, riga), riga.valore]))
    );
  }
  const righe: RigaAnalitica[] = [...chiavi].map((chiave) => {
    const celle: RigaAnalitica["celle"] = senzaVoce ? celleDeiCampi(principale, campiDellaRiga.get(chiave)) : {};
    nonTemporali.forEach((voce, indice) => {
      celle[`serie_${indice}`] = mappe.get(voce)?.get(chiave) ?? 0;
    });
    const valorePrincipale = mappe.get(principale)?.get(chiave) ?? 0;
    Object.assign(
      celle,
      differenze.celle((colonna) => mappe.get(nonTemporali[colonna])?.get(chiave) ?? 0)
    );
    if (obiettivo) {
      const valoreObiettivo = mappe.get(obiettivo)?.get(chiave) ?? 0;
      celle.raggiungimento = valoreObiettivo === 0 ? null : (valorePrincipale / valoreObiettivo) * 100;
    }
    if (temporale) {
      celle.andamento = temporale.risultato.righe
        .filter((riga) => chiaveRiga(temporale, riga) === chiave)
        .sort((a, b) => (a.chiavi.periodo ?? "").localeCompare(b.chiavi.periodo ?? ""))
        .map((riga) => riga.valore);
    }
    return { chiave, celle };
  });
  return { colonne: [...colonneCampi, ...colonne], righe, temporale: false, senzaVoce };
}

function tabellaCompositaNelTempo(
  serie: SerieAnalisiEseguita[],
  principale: SerieAnalisiEseguita,
  scelte?: DifferenzaTabella[]
): { colonne: ColonnaAnalitica[]; righe: RigaAnalitica[]; temporale: true; senzaVoce: true } {
  // La principale per prima: e' la colonna con la barra e il termine di
  // paragone di delta e raggiungimento.
  const ordinate = [principale, ...serie.filter((voce) => voce !== principale)];
  // L'anno precedente va riportato sui periodi di quest'anno, altrimenti
  // «2025-03» e «2026-03» finirebbero su due righe diverse.
  const allineate = ordinate.map((voce) => risultatoAllineatoNelTempo(voce));
  const mappe = allineate.map((risultato) => new Map(risultato.righe.map((riga) => [riga.etichetta, riga.valore])));
  const chiavi = [...new Set(mappe.flatMap((mappa) => [...mappa.keys()]))];
  // Periodo e campi di ogni riga, per le colonne di testo.
  const campiDellaRiga = new Map<string, RigaRisultato["chiavi"]>();
  for (const risultato of allineate) {
    for (const riga of risultato.righe) if (!campiDellaRiga.has(riga.etichetta)) campiDellaRiga.set(riga.etichetta, riga.chiavi);
  }

  const indiceObiettivo = ordinate.findIndex((voce) => voce.ruolo === "obiettivo");
  const unitaPrincipale = principale.risultato.unita;

  const colonne: ColonnaAnalitica[] = ordinate.map((voce, indice) => ({
    chiave: `serie_${indice}`,
    etichetta: voce.nome,
    tipo: indice === 0 && voce.risultato.unita === "euro" ? "barra" : tipoColonna(voce.risultato.unita),
    unita: voce.risultato.unita,
    totale: totaleAutomatico(voce.risultato.unita),
  }));
  const differenze = costruisciDifferenze(
    serie,
    differenzeEffettive(serie, principale, scelte),
    (voce) => ordinate.indexOf(voce),
    unitaPrincipale,
    (confronto) => `Δ ${confronto.nome}`
  );
  colonne.push(...differenze.colonne);
  if (indiceObiettivo > 0) {
    colonne.push({
      chiave: "raggiungimento",
      etichetta: "Raggiungimento",
      tipo: "raggiungimento",
      totale: { tipo: "rapporto", numeratore: "serie_0", denominatore: `serie_${indiceObiettivo}` },
    });
  }

  const righe: RigaAnalitica[] = chiavi.map((chiave) => {
    const celle: RigaAnalitica["celle"] = celleDeiCampi(principale, campiDellaRiga.get(chiave));
    mappe.forEach((mappa, indice) => {
      celle[`serie_${indice}`] = mappa.get(chiave) ?? null;
    });
    const valorePrincipale = mappe[0].get(chiave) ?? 0;
    Object.assign(celle, differenze.celle((colonna) => mappe[colonna].get(chiave) ?? 0));
    if (indiceObiettivo > 0) {
      const atteso = mappe[indiceObiettivo].get(chiave) ?? 0;
      celle.raggiungimento = atteso === 0 ? null : (valorePrincipale / atteso) * 100;
    }
    return { chiave, celle };
  });
  return { colonne: [...colonneDeiCampi(principale), ...colonne], righe, temporale: true, senzaVoce: true };
}

function matriceScostamento(serie: SerieAnalisiEseguita[]) {
  const principale = serie.find((voce) => voce.ruolo === "principale");
  const riferimento = serie.find((voce) => voce.ruolo === "obiettivo" || voce.ruolo === "confronto");
  if (!principale || !riferimento) return null;
  const dimensione = principale.spec.raggruppa?.[0];
  if (!dimensione || !principale.spec.granularita) return null;
  const righe = [...new Set(principale.risultato.righe.map((riga) => riga.chiavi[dimensione]))];
  const colonne = [...new Set(principale.risultato.righe.map((riga) => riga.chiavi.periodo))].sort();
  const mappaRiferimento = new Map(
    riferimento.risultato.righe.map((riga) => [
      `${riga.chiavi[dimensione]}|${riga.chiavi.periodo}`,
      riga.valore,
    ])
  );
  const valori: Record<string, Record<string, number>> = {};
  for (const nomeRiga of righe) valori[nomeRiga] = {};
  for (const riga of principale.risultato.righe) {
    const nomeRiga = riga.chiavi[dimensione];
    const colonna = riga.chiavi.periodo;
    const atteso = mappaRiferimento.get(`${nomeRiga}|${colonna}`) ?? 0;
    valori[nomeRiga][colonna] = atteso === 0 ? 0 : ((riga.valore - atteso) / Math.abs(atteso)) * 100;
  }
  return { righe, colonne, valori };
}

function Ripiego({ risultato, tipo }: { risultato: RisultatoQuery; tipo: TipoGrafico }) {
  return (
    <div className="space-y-3" role="status">
      <p className="text-sm text-text-muted">
        Il grafico «{tipo}» non è applicabile a questi dati. Mostro la tabella completa.
      </p>
      <TabellaRisultato risultato={risultato} />
    </div>
  );
}

export function GraficoDaRisultato({
  risultato,
  tipo,
  altezza = 300,
  coloreSerie,
  onClickEtichetta,
}: ProprietaGraficoDaRisultato): JSX.Element {
  const { colore, coloreNome } = useImpostazioni();
  const tipoScelto = tipo ?? scegliGrafico(risultato).tipo;
  const applicabili = graficiPossibili(risultato);
  const colorePrincipale = coloreSerie ?? (colore(0) || PALETTE[0]);

  if (!applicabili.includes(tipoScelto)) {
    return <Ripiego risultato={risultato} tipo={tipoScelto} />;
  }

  switch (tipoScelto) {
    case "barre":
      return (
        <GraficoBarre
          risultato={risultato}
          altezza={altezza}
          colore={colorePrincipale}
          onClick={onClickEtichetta}
        />
      );
    case "torta":
      return <GraficoTorta risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "linee":
      return (
        <GraficoLinee
          serie={serieTemporali(risultato).map((serie, indice, tutte) => ({
            ...serie,
            // Con una sola serie vale il colore scelto per il riquadro; con
            // una per categoria, ogni business unit porta il suo.
            colore:
              tutte.length === 1 && coloreSerie
                ? coloreSerie
                : coloreNome(serie.nome, indice) || PALETTE[indice % PALETTE.length],
          }))}
          altezza={altezza}
        />
      );
    case "combo":
      return (
        <GraficoCombo
          barre={{ nome: nomeDelRisultato(risultato), risultato, colore: colorePrincipale }}
          linee={[{ nome: `${nomeDelRisultato(risultato)} — andamento`, risultato, colore: colore(1) || PALETTE[1] }]}
          altezza={altezza}
        />
      );
    case "kpi": {
      const riga = risultato.righe[0];
      return <KpiEroe etichetta={riga.etichetta} valore={riga.valore} unita={risultato.unita} />;
    }
    case "tabella":
      return <TabellaRisultato risultato={risultato} onClickRiga={onClickEtichetta} />;
    case "pareto":
      return <Pareto dati={datiSemplici(risultato)} altezza={altezza} onClick={onClickEtichetta} />;
    case "heatmap": {
      const giorni = calendario(risultato);
      if (giorni) return <CalendarioAttivita {...giorni} unita={risultato.unita} onClick={onClickEtichetta} />;
      const dati = matrice(risultato);
      if (!dati) return <Ripiego risultato={risultato} tipo={tipoScelto} />;
      return (
        <Heatmap
          {...dati}
          formato={risultato.unita === "percentuale" ? "percentuale" : "euro"}
          onClick={(riga) => onClickEtichetta?.(riga)}
        />
      );
    }
    case "quadranti":
      return (
        <Quadranti
          punti={risultato.righe.map((riga) => ({
            nome: riga.etichetta,
            x: riga.conteggio,
            y: riga.valore,
            dimensione: Math.abs(riga.valore),
          }))}
          etichettaX="Conteggio"
          etichettaY="Valore"
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "sparkline":
      return (
        <Sparkline
          valori={risultato.righe.map((riga) => riga.valore)}
          larghezza={Math.max(90, Math.min(320, altezza))}
          altezza={Math.min(80, altezza)}
          colore={colorePrincipale}
        />
      );
    case "treemap":
      return (
        <Composizione
          dati={datiSemplici(risultato)}
          unita={risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "anelli": {
      const totale = risultato.totale;
      return (
        <Anelli
          voci={risultato.righe.map((riga) => ({
            etichetta: riga.etichetta,
            percentuale: totale === 0 ? 0 : (riga.valore / totale) * 100,
          }))}
          onClick={onClickEtichetta}
        />
      );
    }
    case "barreImpilate":
      if (!datiBarreImpilate(risultato)) return <Ripiego risultato={risultato} tipo={tipoScelto} />;
      return <BarreImpilate risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "areeImpilate": {
      const dati = aree(risultato);
      if (!dati) return <Ripiego risultato={risultato} tipo={tipoScelto} />;
      return (
        <AreeImpilate
          {...dati}
          unita={risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    }
    case "imbuto":
      return (
        <Imbuto
          fasi={datiSemplici(risultato)}
          unita={risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "bullet":
      // RisultatoQuery non contiene un obiettivo: inventarne uno renderebbe il confronto ingannevole.
      void Bullet;
      return <Ripiego risultato={risultato} tipo={tipoScelto} />;

    // I sei tipi nuovi. `graficiPossibili` li ha gia' esclusi quando la forma
    // del dato non li regge — il controllo sopra e' passato — quindi qui si
    // disegna e basta: ognuno dichiara da se' cosa manca nei casi limite.
    case "matrice":
      return <Matrice risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "pendenza":
      return <Pendenza risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "distribuzione":
      return <Distribuzione risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "posizioni":
      return <Posizioni risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "flusso":
      return <Flusso risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "istogramma":
      return <Istogramma risultato={risultato} altezza={altezza} />;
    case "mappa":
      return <MappaVisite risultato={risultato} altezza={altezza} />;
  }
}

/**
 * La tinta di una serie: quella scelta a mano se c'è, altrimenti la palette.
 *
 * Il colore scelto conta soprattutto qui, dove le serie sono più di una:
 * affiancare ordinato, budget e BEP senza poter dire quale è quale lascia la
 * legenda come unico appiglio.
 */
function tintaSerie(
  voce: SerieAnalisiEseguita,
  indice: number,
  dalNome: (nome: string, posizione: number) => string,
  aspetto?: AspettoGrafico | null
): string {
  // Il colore scelto nel pannello Aspetto prevale su quello dato alla serie
  // quando è stata aggiunta: è la scelta più recente e più esplicita.
  return (
    aspetto?.colori?.[voce.nome] ??
    voce.colore ??
    (dalNome(voce.nome, indice) || PALETTE[indice % PALETTE.length])
  );
}

function TabellaComposita({
  serie,
  onClickRiga,
}: {
  serie: SerieAnalisiEseguita[];
  onClickRiga?: (etichetta: string) => void;
}) {
  const { aspetto } = useImpostazioni();
  const { temporale, senzaVoce, ...dati } = tabellaComposita(serie, aspetto?.tabella?.differenze);
  return (
    <TabellaAnalitica
      {...dati}
      senzaColonnaVoce={senzaVoce}
      colonnaDimensione={temporale ? "Periodo" : "Voce"}
      colonnaOrdinamentoIniziale={
        aspetto?.tabella?.ordinaPer ? undefined : temporale ? (senzaVoce ? "d_periodo" : COLONNA_VOCE) : undefined
      }
      massimoIniziale={temporale ? 15 : 12}
      onClickRiga={onClickRiga}
    />
  );
}

/**
 * Distribuisce ruoli e risultati sulle firme già usate dai grafici del Cruscotto.
 *
 * L'aspetto del riquadro avvolge tutto il sottoalbero: i grafici lo leggono
 * dal contesto come le impostazioni generali, senza doverlo ricevere a mano.
 */
export function GraficoDaAnalisi({ aspetto, ...proprieta }: ProprietaGraficoDaAnalisi): JSX.Element {
  return (
    <AspettoLocale aspetto={aspetto}>
      <CorpoGraficoDaAnalisi {...proprieta} />
    </AspettoLocale>
  );
}

function CorpoGraficoDaAnalisi({
  serie,
  tipo,
  altezza = 300,
  onClickEtichetta,
}: Omit<ProprietaGraficoDaAnalisi, "aspetto">): JSX.Element {
  const { coloreNome, coloreFisso, aspetto } = useImpostazioni();
  const colore = coloreNome;
  const principale = serie.find((voce) => voce.ruolo === "principale") ?? serie[0];
  if (!principale) {
    return <p role="status" className="text-sm text-text-muted">Nessuna serie disponibile.</p>;
  }
  if (serie.length === 1) {
    return (
      <GraficoDaRisultato
        risultato={principale.risultato}
        tipo={tipo}
        altezza={altezza}
        coloreSerie={aspetto?.colori?.[principale.nome] ?? principale.colore ?? coloreFisso(principale.nome)}
        onClickEtichetta={onClickEtichetta}
      />
    );
  }

  const tipoScelto = tipo ?? scegliGrafico(serie).tipo;
  if (!graficiPossibili(serie).includes(tipoScelto)) {
    return <TabellaComposita serie={serie} />;
  }

  switch (tipoScelto) {
    case "linee":
      return (
        <GraficoLinee
          serie={serie.map((voce, indice) => ({
            nome: voce.nome,
            risultato: risultatoAllineatoNelTempo(voce),
            colore: tintaSerie(voce, indice, colore, aspetto),
            tratteggiata: voce.ruolo !== "principale",
          }))}
          altezza={altezza}
        />
      );
    case "combo":
      return (
        <GraficoCombo
          barre={{
            nome: principale.nome,
            risultato: principale.risultato,
            colore: tintaSerie(principale, 0, colore, aspetto),
          }}
          linee={serie
            .filter((voce) => voce !== principale)
            .map((voce, indice) => ({
              nome: voce.nome,
              risultato: risultatoAllineatoNelTempo(voce),
              colore: tintaSerie(voce, indice + 1, colore, aspetto),
              tratteggiata: voce.ruolo !== "principale",
            }))}
          altezza={altezza}
        />
      );
    case "bullet":
      return <Bullet righe={righeBullet(serie)} onClick={onClickEtichetta} />;
    case "barre": {
      const riferimento = serie.find(
        (voce) => voce.ruolo === "confronto" || voce.ruolo === "obiettivo"
      );
      if (!riferimento) {
        return <GraficoDaRisultato risultato={principale.risultato} tipo="barre" altezza={altezza} />;
      }
      const attesi = valorePerEtichetta(riferimento.risultato);
      return (
        <BarreScostamento
          dati={principale.risultato.righe.map((riga) => ({
            etichetta: riga.etichetta,
            valore: riga.valore - (attesi.get(riga.etichetta) ?? 0),
          }))}
          altezza={altezza}
          formato={principale.risultato.unita === "percentuale" ? "percentuale" : "euro"}
          onClick={onClickEtichetta}
        />
      );
    }
    case "kpi": {
      const confronto = serie.find((voce) => voce.ruolo === "confronto");
      const obiettivo = serie.find((voce) => voce.ruolo === "obiettivo");
      return (
        <KpiEroe
          etichetta={principale.nome}
          valore={principale.risultato.totale}
          unita={principale.risultato.unita}
          confronto={confronto ? { valore: confronto.risultato.totale, etichetta: confronto.nome } : null}
          nota={obiettivo ? `Obiettivo: ${obiettivo.nome}` : undefined}
        />
      );
    }
    case "quadranti": {
      const confronto = serie.find((voce) => voce.ruolo === "confronto");
      if (!confronto) return <GraficoDaRisultato risultato={principale.risultato} tipo="quadranti" />;
      const precedenti = valorePerEtichetta(confronto.risultato);
      return (
        <Quadranti
          punti={principale.risultato.righe.map((riga) => {
            const precedente = precedenti.get(riga.etichetta) ?? 0;
            return {
              nome: riga.etichetta,
              x: precedente,
              y: precedente === 0 ? 0 : ((riga.valore - precedente) / Math.abs(precedente)) * 100,
              dimensione: Math.abs(riga.valore),
            };
          })}
          etichettaX={confronto.nome}
          etichettaY="Variazione %"
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    }
    case "heatmap": {
      const dati = matriceScostamento(serie);
      if (!dati) return <GraficoDaRisultato risultato={principale.risultato} tipo="heatmap" />;
      return (
        <Heatmap
          {...dati}
          formato="percentuale"
          divergente
          onClick={(riga) => onClickEtichetta?.(riga)}
        />
      );
    }
    case "imbuto":
      return (
        <Imbuto
          fasi={serie.map((voce) => ({ etichetta: voce.nome, valore: voce.risultato.totale }))}
          unita={principale.risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "treemap":
      return (
        <Composizione
          dati={serie.map((voce) => ({ etichetta: voce.nome, valore: voce.risultato.totale }))}
          unita={principale.risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "areeImpilate": {
      const periodi = [...new Set(serie.flatMap((voce) =>
        voce.risultato.righe.map((riga) => riga.chiavi.periodo ?? riga.etichetta)
      ))].sort();
      return (
        <AreeImpilate
          periodi={periodi}
          serie={serie.map((voce) => ({
            nome: voce.nome,
            valori: Object.fromEntries(
              voce.risultato.righe.map((riga) => [riga.chiavi.periodo ?? riga.etichetta, riga.valore])
            ),
          }))}
          unita={principale.risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    }
    case "tabella":
      return <TabellaComposita serie={serie} onClickRiga={onClickEtichetta} />;
    default:
      return (
        <GraficoDaRisultato
          risultato={principale.risultato}
          tipo={tipoScelto}
          altezza={altezza}
          onClickEtichetta={onClickEtichetta}
        />
      );
  }
}
