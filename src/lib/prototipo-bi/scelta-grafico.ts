/**
 * QUALE GRAFICO PER QUESTO RISULTATO.
 *
 * La scelta la propone il sistema leggendo la FORMA del dato — quante righe,
 * se c'è un asse temporale, quante dimensioni, che unità — e l'utente la
 * cambia se vuole. Lasciarla a lui al primo colpo significa, in pratica, che
 * tutto finisce in barre: chi guarda un cruscotto vuole una risposta, non un
 * catalogo di tipi di grafico.
 *
 * Le regole dure valgono anche contro la volontà del chiamante, perché sono
 * errori di lettura e non questioni di gusto: una serie temporale non finisce
 * mai in una torta (l'ordine dei mesi sparisce), una percentuale nemmeno
 * (sommare percentuali non significa niente), e le quote non si disegnano su
 * valori negativi.
 *
 * Serve a tre posti diversi — l'analista AI che risponde con un grafico,
 * l'editor manuale, i report — e per questo non sa niente di nessuno dei tre:
 * riceve un `RisultatoQuery` e restituisce un tipo con il suo motivo.
 */

import type { RisultatoQuery, SerieAnalisiEseguita } from "./tipi";

export type TipoGrafico =
  | "linee"
  | "barre"
  | "combo"
  | "torta"
  | "anelli"
  | "areeImpilate"
  | "pareto"
  | "bullet"
  | "heatmap"
  | "quadranti"
  | "imbuto"
  | "treemap"
  | "sparkline"
  | "kpi"
  | "tabella";

export interface PropostaGrafico {
  tipo: TipoGrafico;
  motivo: string;
  alternative: TipoGrafico[];
}

interface SceltaBase {
  tipo: TipoGrafico;
  motivo: string;
}

function categorieDistinte(risultato: RisultatoQuery): number {
  const dimensione = risultato.spec.raggruppa?.[0];
  if (!dimensione) return 0;
  return new Set(risultato.righe.map((riga) => riga.chiavi[dimensione])).size;
}

function determinaScelta(risultato: RisultatoQuery): SceltaBase {
  const numeroRighe = risultato.righe.length;
  const raggruppamenti = risultato.spec.raggruppa ?? [];
  const temporale = risultato.spec.granularita !== undefined;

  if (numeroRighe === 0) {
    return { tipo: "tabella", motivo: "Nessun dato disponibile: la tabella mostra chiaramente lo stato vuoto." };
  }
  if (numeroRighe === 1 && raggruppamenti.length === 0) {
    return { tipo: "kpi", motivo: "Un solo valore complessivo: una KPI lo rende immediatamente leggibile." };
  }
  if (temporale && raggruppamenti.length === 0) {
    return { tipo: "linee", motivo: "Serie temporale: la linea mette in evidenza andamento e cambi di ritmo." };
  }
  if (temporale && raggruppamenti.length === 1) {
    const categorie = categorieDistinte(risultato);
    if (categorie <= 6) {
      return {
        tipo: "areeImpilate",
        motivo: `${categorie} categorie nel tempo: le aree impilate mostrano insieme volume e composizione.`,
      };
    }
    return {
      tipo: "linee",
      motivo: `${categorie} categorie nel tempo: mostro le prime 6 per valore; le altre ${categorie - 6} restano escluse per mantenere il confronto leggibile.`,
    };
  }
  if (raggruppamenti.length === 2) {
    return {
      tipo: "heatmap",
      motivo: "Due dimensioni di confronto: la matrice rende visibili concentrazioni e incroci.",
    };
  }
  if (risultato.unita === "percentuale") {
    return {
      tipo: "barre",
      motivo: `${numeroRighe} percentuali: le barre consentono un confronto diretto sulla stessa scala.`,
    };
  }
  if (
    numeroRighe <= 8 &&
    (risultato.unita === "euro" || risultato.unita === "numero") &&
    risultato.righe.every((riga) => riga.valore >= 0)
  ) {
    return {
      tipo: "torta",
      motivo: `${numeroRighe} categorie: la torta rende immediata la quota di ciascuna sul totale.`,
    };
  }
  if (numeroRighe >= 9 && numeroRighe <= 30) {
    return {
      tipo: "barre",
      motivo: `${numeroRighe} categorie: le barre ordinate si leggono meglio di una torta.`,
    };
  }
  if (numeroRighe > 30) {
    return {
      tipo: "pareto",
      motivo: `${numeroRighe} categorie: il Pareto evidenzia quali voci concentrano la maggior parte del valore.`,
    };
  }
  // Fondo della catena: poche righe con un'unità che non è né euro né numero
  // né percentuale — i giorni, tipicamente. Ci finiva "giorni medi di risposta
  // per addetto", cinque valori perfettamente confrontabili, e usciva una
  // tabella. Le barre sono la rappresentazione onesta di un elenco corto di
  // grandezze omogenee, qualunque sia l'unità.
  return {
    tipo: "barre",
    motivo: `${numeroRighe} valori in ${risultato.unita}: le barre li mettono a confronto sulla stessa scala.`,
  };
}

function graficiApplicabili(risultato: RisultatoQuery): TipoGrafico[] {
  const numeroRighe = risultato.righe.length;
  if (numeroRighe === 0) return ["tabella"];

  const raggruppamenti = risultato.spec.raggruppa ?? [];
  const temporale = risultato.spec.granularita !== undefined;
  const tuttiNonNegativi = risultato.righe.every((riga) => riga.valore >= 0);
  const possibili: TipoGrafico[] = [];

  if (numeroRighe === 1 && raggruppamenti.length === 0) possibili.push("kpi");
  if (temporale) {
    // Niente "combo": vuole due misure diverse (l'ordinato a barre, il budget
    // a linea). Con un solo RisultatoQuery le due serie sarebbero lo stesso
    // dato disegnato due volte — sembra un confronto e non lo è. Tornerà
    // quando il chiamante potrà passare una seconda serie.
    possibili.push("linee");
    if (numeroRighe >= 2) possibili.push("sparkline");
    if (raggruppamenti.length === 1 && categorieDistinte(risultato) <= 6) {
      possibili.push("areeImpilate");
    }
  }
  if (raggruppamenti.length === 2 || (temporale && raggruppamenti.length === 1)) {
    possibili.push("heatmap");
  }

  possibili.push("barre");
  if (numeroRighe >= 2) possibili.push("pareto", "quadranti");

  if (!temporale) {
    if (
      risultato.unita !== "percentuale" &&
      numeroRighe <= 8 &&
      tuttiNonNegativi
    ) {
      possibili.push("torta", "anelli");
    }
    if (numeroRighe >= 2 && tuttiNonNegativi) possibili.push("imbuto");
    if (risultato.righe.some((riga) => riga.valore > 0)) possibili.push("treemap");
  }

  possibili.push("tabella");
  return [...new Set(possibili)];
}

function determinaSceltaAnalisi(serie: SerieAnalisiEseguita[]): SceltaBase {
  const principale = serie.find((voce) => voce.ruolo === "principale") ?? serie[0];
  if (!principale) {
    return { tipo: "tabella", motivo: "Nessuna serie disponibile: la tabella rende esplicito lo stato vuoto." };
  }
  const risultato = principale.risultato;
  const haObiettivo = serie.some((voce) => voce.ruolo === "obiettivo");
  const haConfronto = serie.some((voce) => voce.ruolo === "confronto");
  const temporale = serie.some((voce) => voce.risultato.spec.granularita !== undefined);
  const senzaDimensioni = (risultato.spec.raggruppa?.length ?? 0) === 0;

  if (haObiettivo) {
    return {
      tipo: "bullet",
      motivo: "Consuntivo e obiettivo: il bullet mostra distanza dal traguardo e dall'eventuale soglia.",
    };
  }
  if (temporale) {
    return {
      tipo: "linee",
      motivo: "Più serie nel tempo: le linee consentono di confrontarne ritmo e scostamenti sullo stesso asse.",
    };
  }
  if (haConfronto && senzaDimensioni) {
    return {
      tipo: "kpi",
      motivo: "Un valore complessivo e il suo confronto: la KPI rende subito visibili valore e variazione.",
    };
  }
  if (haConfronto) {
    return {
      tipo: "barre",
      motivo: "Categorie confrontate sulla stessa misura: le barre di scostamento evidenziano chi sale e chi scende.",
    };
  }
  return determinaScelta(risultato);
}

function graficiApplicabiliAnalisi(serie: SerieAnalisiEseguita[]): TipoGrafico[] {
  const principale = serie.find((voce) => voce.ruolo === "principale") ?? serie[0];
  if (!principale) return ["tabella"];
  const risultato = principale.risultato;
  const temporale = serie.some((voce) => voce.risultato.spec.granularita !== undefined);
  const haObiettivo = serie.some((voce) => voce.ruolo === "obiettivo");
  const haConfronto = serie.some((voce) => voce.ruolo === "confronto");
  const stessaUnita = serie.every((voce) => voce.risultato.unita === risultato.unita);
  const tuttiNonNegativi = serie.every((voce) =>
    voce.risultato.righe.every((riga) => riga.valore >= 0)
  );
  const possibili: TipoGrafico[] = [];

  if (haObiettivo) possibili.push("bullet");
  if (temporale) possibili.push("linee", "combo");
  if (haConfronto || (risultato.spec.raggruppa?.length ?? 0) > 0) {
    possibili.push("barre", "quadranti");
  }
  if ((risultato.spec.raggruppa?.length ?? 0) === 0) possibili.push("kpi");
  if (stessaUnita && tuttiNonNegativi) possibili.push("imbuto", "treemap");
  if (temporale && (risultato.spec.raggruppa?.length ?? 0) > 0) {
    possibili.push("heatmap", "areeImpilate");
  }
  possibili.push("tabella");
  return [...new Set(possibili)];
}

export function graficiPossibili(
  risultato: RisultatoQuery | SerieAnalisiEseguita[]
): TipoGrafico[] {
  if (Array.isArray(risultato)) {
    const applicabili = graficiApplicabiliAnalisi(risultato);
    const principale = determinaSceltaAnalisi(risultato).tipo;
    return [principale, ...applicabili.filter((tipo) => tipo !== principale)];
  }
  const applicabili = graficiApplicabili(risultato);
  const principale = determinaScelta(risultato).tipo;
  return [principale, ...applicabili.filter((tipo) => tipo !== principale)];
}

export function scegliGrafico(
  risultato: RisultatoQuery | SerieAnalisiEseguita[]
): PropostaGrafico {
  const scelta = Array.isArray(risultato)
    ? determinaSceltaAnalisi(risultato)
    : determinaScelta(risultato);
  const applicabili = Array.isArray(risultato)
    ? graficiApplicabiliAnalisi(risultato)
    : graficiApplicabili(risultato);
  return {
    ...scelta,
    alternative: applicabili.filter((tipo) => tipo !== scelta.tipo),
  };
}
