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
  | "matrice"
  | "pendenza"
  | "distribuzione"
  | "posizioni"
  | "flusso"
  | "istogramma"
  | "kpi"
  | "tabella";

/**
 * I nomi da mostrare all'utente.
 *
 * Stanno qui, accanto al tipo, e non nei componenti: erano duplicati identici
 * in due file diversi e ogni tipo nuovo li rompeva entrambi, sempre con lo
 * stesso errore. Tenerli legati alla definizione fa segnalare a TypeScript
 * l'unico punto da aggiornare.
 */
export const NOMI_GRAFICI: Record<TipoGrafico, string> = {
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
  matrice: "Matrice",
  pendenza: "Pendenza",
  distribuzione: "Distribuzione",
  posizioni: "Posizioni in classifica",
  flusso: "Flusso a stadi",
  istogramma: "Istogramma",
  kpi: "KPI",
  tabella: "Tabella",
};

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

function periodiDistinti(risultato: RisultatoQuery): number {
  return new Set(
    risultato.righe
      .map((riga) => riga.chiavi.periodo)
      .filter((periodo): periodo is string => Boolean(periodo))
  ).size;
}

function categorieDistintePer(risultato: RisultatoQuery, dimensione: string): number {
  return new Set(
    risultato.righe
      .map((riga) => riga.chiavi[dimensione])
      .filter((categoria): categoria is string => Boolean(categoria))
  ).size;
}

function haDueDimensioniPiccole(risultato: RisultatoQuery): boolean {
  const dimensioni = risultato.spec.raggruppa ?? [];
  return dimensioni.length === 2 && dimensioni.every(
    (dimensione) => categorieDistintePer(risultato, dimensione) <= 12
  );
}

function haFlussoDecrescente(risultato: RisultatoQuery): boolean {
  return risultato.righe.length >= 2 && risultato.righe.every(
    (riga, indice, righe) => indice === 0 || riga.valore <= righe[indice - 1].valore
  );
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
  if (temporale && raggruppamenti.length === 1 && periodiDistinti(risultato) === 2) {
    return {
      tipo: "pendenza",
      motivo: "Due periodi per categoria: la pendenza rende immediati aumenti e diminuzioni.",
    };
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
      tipo: haDueDimensioniPiccole(risultato) ? "matrice" : "heatmap",
      motivo: haDueDimensioniPiccole(risultato)
        ? "Due dimensioni compatte: la matrice mostra incroci e totali senza perdere precisione."
        : "Due dimensioni estese: la mappa di calore rende visibili concentrazioni e incroci.",
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
    // Oltre sei categorie il grafico somma le minori in «Altri»: resta leggibile,
    // e rifiutarlo lasciava al suo posto una tabella con una riga per mese e persona.
    if (raggruppamenti.length === 1 && categorieDistinte(risultato) >= 2) {
      possibili.push("areeImpilate");
    }
    if (raggruppamenti.length === 1) {
      const periodi = periodiDistinti(risultato);
      if (periodi === 2) possibili.push("pendenza");
      // Il box plot vuole abbastanza osservazioni per avere dei quartili veri.
      // Con due o tre periodi la mediana e' il punto di mezzo, Q1 coincide con
      // il minimo e Q3 con il massimo: si disegnerebbe una scatola che non
      // dice niente e sembra dire qualcosa. Cinque e' la soglia sotto cui una
      // distribuzione non si legge.
      if (periodi >= 5) possibili.push("distribuzione");
      if (periodi >= 3) possibili.push("posizioni");
    }
  }
  // Serie giornaliera senza suddivisioni: la heatmap e' un calendario.
  const calendario = risultato.spec.granularita === "giorno" && raggruppamenti.length === 0;
  if (raggruppamenti.length === 2 || (temporale && raggruppamenti.length === 1) || calendario) {
    possibili.push("heatmap");
  }
  if (raggruppamenti.length === 2) possibili.push("matrice");

  possibili.push("barre");
  if (numeroRighe >= 2) possibili.push("pareto", "quadranti");
  // Un istogramma raggruppa i valori in fasce di frequenza: con poche righe le
  // fasce sono piu' delle osservazioni e il risultato e' un grafico a barre
  // travestito, con in piu' il difetto di nascondere le etichette.
  if (numeroRighe >= 8) possibili.push("istogramma");

  if (!temporale) {
    if (
      risultato.unita !== "percentuale" &&
      numeroRighe <= 8 &&
      tuttiNonNegativi
    ) {
      possibili.push("torta", "anelli");
    }
    if (numeroRighe >= 2 && tuttiNonNegativi) possibili.push("imbuto");
    if (
      raggruppamenti.length === 1 &&
      risultato.unita !== "percentuale" &&
      tuttiNonNegativi &&
      haFlussoDecrescente(risultato)
    ) {
      possibili.push("flusso");
    }
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
  const nuoviSulPrincipale = graficiApplicabili(risultato).filter((tipo) =>
    (["matrice", "pendenza", "distribuzione", "posizioni", "flusso", "istogramma"] as TipoGrafico[])
      .includes(tipo)
  );
  possibili.push(...nuoviSulPrincipale);
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

/**
 * Cosa manca per poter scegliere gli altri grafici.
 *
 * La tendina delle visualizzazioni si accorcia da sola quando la forma del
 * dato non regge un tipo — ed e' giusto — ma non dice perche', e chi guarda
 * non ha modo di sapere che gli basterebbe cambiare una tendina. E' successo
 * davvero: «fatturato con budget e BEP» senza granularita' offre solo cinque
 * tipi, e il Combinato che l'AI aveva prodotto sembrava irraggiungibile.
 *
 * Si elencano solo le mancanze **rimediabili con un gesto**: dire «manca la
 * torta perche' ci sono valori negativi» non aiuta nessuno, perche' non e' una
 * cosa che si sistema spuntando qualcosa.
 */
export function comeSbloccareAltriGrafici(
  risultato: RisultatoQuery | SerieAnalisiEseguita[]
): string[] {
  const serie = Array.isArray(risultato) ? risultato : null;
  const principale = serie
    ? (serie.find((voce) => voce.ruolo === "principale") ?? serie[0])?.risultato
    : (risultato as RisultatoQuery);
  if (!principale) return [];

  const temporale = serie
    ? serie.some((voce) => voce.risultato.spec.granularita !== undefined)
    : principale.spec.granularita !== undefined;
  const raggruppamenti = principale.spec.raggruppa?.length ?? 0;

  const suggerimenti: string[] = [];
  if (!temporale) {
    suggerimenti.push(
      "Per vedere Linee e Combinato serve un asse del tempo: in «Quando» scegli " +
        "una granularità (per esempio Mese) al posto di «Totale del periodo»."
    );
  }
  if (raggruppamenti === 0) {
    suggerimenti.push(
      "Per confrontare Barre, Pareto o Quadranti serve una suddivisione: " +
        "spunta per esempio Cliente o Agente."
    );
  }
  if (temporale && raggruppamenti === 0) {
    suggerimenti.push(
      "Aggiungendo una suddivisione a una serie nel tempo compaiono anche Aree " +
        "impilate e Mappa di calore."
    );
  }
  return suggerimenti;
}
