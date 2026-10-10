/**
 * L'ASPETTO DI UN RIQUADRO: COLORI AZIENDALI E SCELTE DI RESA.
 *
 * Due cose stanno qui perché servono sia al server sia al browser:
 *
 *  · i colori SICS e la loro assegnazione alle business unit. Vengono dal
 *    report Power BI «STATISTICHE SICS» (le regole `dataPoint` per
 *    Gruppo Descrizione), riportati sulla palette aziendale ufficiale;
 *
 *  · `validaAspetto`, l'unico imbuto da cui passa un aspetto prima di finire
 *    nel database. I colori diventano attributi SVG: si accetta soltanto
 *    `#rrggbb`, come per il colore delle serie.
 */

import type { AggregazioneTotale, AspettoAsse, AspettoGrafico, PosizioneLegenda } from "./tipi";

/** La palette ufficiale SICS. */
export const COLORI_SICS = {
  turchese: "#00A1BE",
  grigio: "#747373",
  verde: "#95C11F",
  arancio: "#EE7326",
  rosso: "#E73331",
  fucsia: "#C82381",
} as const;

/**
 * Colore fisso di ogni business unit, uguale in tutti i grafici.
 *
 * Dal PBIX: COMPONENTI #95C11F e IMPIANTI #E73331 coincidono con la palette
 * SICS; COSTRUITO era #EB895F, portato sull'arancio SICS; STRUTTURE era un
 * giallo (#F4C948) che la palette non ha, e prende il turchese — l'unica
 * tinta SICS che nel report non indicava già un'altra cosa per le BU.
 * Il fucsia resta al budget, come nel report.
 */
export const COLORI_BU: Record<string, string> = {
  COMPONENTI: COLORI_SICS.verde,
  IMPIANTI: COLORI_SICS.rosso,
  COSTRUITO: COLORI_SICS.arancio,
  STRUTTURE: COLORI_SICS.turchese,
  "(non assegnata)": "#B3B3B3",
};

const COLORE_VALIDO = /^#[0-9a-f]{6}$/iu;

/** Sfondi proposti per un riquadro (chiari, tranne il turchese SICS). */
export const SFONDI_RIQUADRO: { nome: string; colore: string }[] = [
  { nome: "Azzurro chiaro", colore: "#e6f6f9" },
  { nome: "Verde chiaro", colore: "#eef7da" },
  { nome: "Giallo chiaro", colore: "#fff4de" },
  { nome: "Rosso chiaro", colore: "#fdeaea" },
  { nome: "Grigio chiaro", colore: "#f1f5f9" },
  { nome: "Turchese SICS", colore: "#00a1be" },
];

/**
 * Con un colore del testo scelto, anche i testi che hanno una classe colore
 * propria (numeri delle KPI, etichette) lo seguono.
 */
export function classiTestoRiquadro(aspetto?: AspettoGrafico | null): string {
  const colorato = Boolean(aspetto?.sfondo || aspetto?.coloreTesto);
  const centrato = aspetto?.testoCentrato ? "text-center " : "";
  return `${centrato}${colorato ? "[&_.text-text]:!text-[color:inherit] [&_.text-text-muted]:!text-[color:inherit] [&_.text-text-muted]:opacity-80" : ""}`.trim();
}

/** Stile del riquadro: sfondo e colore del testo scelti, se ce ne sono. */
export function stileRiquadro(aspetto?: AspettoGrafico | null): { backgroundColor?: string; color?: string } | undefined {
  if (!aspetto?.sfondo && !aspetto?.coloreTesto) return undefined;
  return {
    ...(aspetto.sfondo ? { backgroundColor: aspetto.sfondo } : {}),
    color: aspetto.coloreTesto ?? coloreTestoSu(aspetto.sfondo ?? "#ffffff"),
  };
}

/** Testo leggibile sopra uno sfondo: bianco sui scuri, nero-blu sui chiari. */
export function coloreTestoSu(sfondo: string): string {
  const n = Number.parseInt(sfondo.slice(1), 16);
  const luminanza = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminanza < 0.6 ? "#ffffff" : "#1a202c";
}
const LEGENDE: PosizioneLegenda[] = ["sotto", "sopra", "destra", "nascosta"];
export const AGGREGAZIONI_TOTALE: AggregazioneTotale[] = [
  "automatico",
  "somma",
  "media",
  "minimo",
  "massimo",
  "conteggio",
  "nessuno",
];
const MASSIMO_COLORI = 60;
const MASSIMO_DIFFERENZE = 6;
const MASSIMO_MISURE = 12;

export class AspettoNonValido extends Error {}

function oggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

function testoBreve(valore: unknown, nome: string): string | undefined {
  if (valore === undefined || valore === null || valore === "") return undefined;
  if (typeof valore !== "string") throw new AspettoNonValido(`${nome} deve essere un testo.`);
  const pulito = valore.trim().slice(0, 80);
  return pulito || undefined;
}

function numeroFinito(valore: unknown, nome: string): number | undefined {
  if (valore === undefined || valore === null || valore === "") return undefined;
  const n = typeof valore === "number" ? valore : Number(valore);
  if (!Number.isFinite(n)) throw new AspettoNonValido(`${nome} deve essere un numero.`);
  return n;
}

function booleano(valore: unknown, nome: string): boolean | undefined {
  if (valore === undefined || valore === null) return undefined;
  if (typeof valore !== "boolean") throw new AspettoNonValido(`${nome} deve essere vero o falso.`);
  return valore;
}

function validaAsse(valore: unknown, nome: string, conEstremi: boolean): AspettoAsse | undefined {
  if (valore === undefined || valore === null) return undefined;
  if (!oggetto(valore)) throw new AspettoNonValido(`${nome} non valido.`);
  const asse: AspettoAsse = {};
  const visibile = booleano(valore.visibile, `${nome}: visibile`);
  const titolo = testoBreve(valore.titolo, `${nome}: titolo`);
  if (visibile !== undefined) asse.visibile = visibile;
  if (titolo) asse.titolo = titolo;
  if (conEstremi) {
    const minimo = numeroFinito(valore.minimo, `${nome}: minimo`);
    const massimo = numeroFinito(valore.massimo, `${nome}: massimo`);
    if (minimo !== undefined && massimo !== undefined && minimo >= massimo) {
      throw new AspettoNonValido(`${nome}: il minimo deve essere minore del massimo.`);
    }
    if (minimo !== undefined) asse.minimo = minimo;
    if (massimo !== undefined) asse.massimo = massimo;
  }
  return Object.keys(asse).length > 0 ? asse : undefined;
}

/**
 * Pulisce un aspetto arrivato dal browser. Restituisce `null` quando non resta
 * niente: un oggetto vuoto salvato vorrebbe dire la stessa cosa ma
 * sporcherebbe il confronto «è cambiato qualcosa?».
 */
export function validaAspetto(valore: unknown): AspettoGrafico | null {
  if (valore === undefined || valore === null) return null;
  if (!oggetto(valore)) throw new AspettoNonValido("Aspetto del grafico non valido.");
  const aspetto: AspettoGrafico = {};

  if (valore.colori !== undefined && valore.colori !== null) {
    if (!oggetto(valore.colori)) throw new AspettoNonValido("I colori devono essere un elenco nome → colore.");
    const voci = Object.entries(valore.colori);
    if (voci.length > MASSIMO_COLORI) throw new AspettoNonValido("Troppi colori personalizzati.");
    const colori: Record<string, string> = {};
    for (const [nome, colore] of voci) {
      if (typeof colore !== "string" || !COLORE_VALIDO.test(colore)) {
        throw new AspettoNonValido(`Colore non valido per «${nome}»: usare #rrggbb.`);
      }
      const chiave = nome.trim().slice(0, 120);
      if (chiave) colori[chiave] = colore.toLowerCase();
    }
    if (Object.keys(colori).length > 0) aspetto.colori = colori;
  }

  if (valore.legenda !== undefined && valore.legenda !== null) {
    if (!LEGENDE.includes(valore.legenda as PosizioneLegenda)) {
      throw new AspettoNonValido("Posizione della legenda non valida.");
    }
    aspetto.legenda = valore.legenda as PosizioneLegenda;
  }

  if (valore.sfondo !== undefined && valore.sfondo !== null) {
    if (typeof valore.sfondo !== "string" || !COLORE_VALIDO.test(valore.sfondo)) {
      throw new AspettoNonValido("Sfondo non valido: usare #rrggbb.");
    }
    aspetto.sfondo = valore.sfondo.toLowerCase();
  }
  if (valore.coloreTesto !== undefined && valore.coloreTesto !== null) {
    if (typeof valore.coloreTesto !== "string" || !COLORE_VALIDO.test(valore.coloreTesto)) {
      throw new AspettoNonValido("Colore del testo non valido: usare #rrggbb.");
    }
    aspetto.coloreTesto = valore.coloreTesto.toLowerCase();
  }
  const centrato = booleano(valore.testoCentrato, "Testo centrato");
  if (centrato) aspetto.testoCentrato = true;

  const griglia = booleano(valore.griglia, "Griglia");
  if (griglia !== undefined) aspetto.griglia = griglia;
  const etichette = booleano(valore.etichetteValori, "Etichette dei valori");
  if (etichette !== undefined) aspetto.etichetteValori = etichette;

  const asseX = validaAsse(valore.asseX, "Asse orizzontale", false);
  const asseY = validaAsse(valore.asseY, "Asse dei valori", true);
  if (asseX) aspetto.asseX = asseX;
  if (asseY) aspetto.asseY = asseY;

  if (valore.tabella !== undefined && valore.tabella !== null) {
    if (!oggetto(valore.tabella)) throw new AspettoNonValido("Impostazioni della tabella non valide.");
    const tabella: NonNullable<AspettoGrafico["tabella"]> = {};
    const totale = valore.tabella.totale;
    if (totale !== undefined && totale !== null) {
      if (!AGGREGAZIONI_TOTALE.includes(totale as AggregazioneTotale)) {
        throw new AspettoNonValido("Tipo di totale non valido.");
      }
      tabella.totale = totale as AggregazioneTotale;
    }
    const ordinaPer = testoBreve(valore.tabella.ordinaPer, "Colonna di ordinamento");
    if (ordinaPer) tabella.ordinaPer = ordinaPer;
    const verso = valore.tabella.verso;
    if (verso !== undefined && verso !== null) {
      if (verso !== "asc" && verso !== "desc") throw new AspettoNonValido("Verso di ordinamento non valido.");
      tabella.verso = verso;
    }
    const differenze = valore.tabella.differenze;
    if (differenze !== undefined && differenze !== null) {
      if (!Array.isArray(differenze) || differenze.length > MASSIMO_DIFFERENZE) {
        throw new AspettoNonValido("Le differenze della tabella non sono valide.");
      }
      // Un elenco vuoto vale: significa «nessuna differenza, nemmeno quella automatica».
      tabella.differenze = differenze.map((voce) => {
        if (!oggetto(voce)) throw new AspettoNonValido("Differenza non valida.");
        const { da, con, modo } = voce;
        const indiceValido = (n: unknown): n is number =>
          typeof n === "number" && Number.isInteger(n) && n >= 0 && n < MASSIMO_MISURE;
        if (!indiceValido(da) || !indiceValido(con) || da === con) {
          throw new AspettoNonValido("Una differenza confronta due misure diverse del riquadro.");
        }
        if (modo !== undefined && modo !== null && modo !== "assoluta" && modo !== "percentuale") {
          throw new AspettoNonValido("Tipo di differenza non valido.");
        }
        return modo === "percentuale" ? { da, con, modo } : { da, con };
      });
    }
    if (Object.keys(tabella).length > 0) aspetto.tabella = tabella;
  }

  return Object.keys(aspetto).length > 0 ? aspetto : null;
}

/** Colore fissato per un nome: prima quello del riquadro, poi quello della BU. */
export function coloreFissato(nome: string, aspetto?: AspettoGrafico | null): string | undefined {
  return aspetto?.colori?.[nome] ?? COLORI_BU[nome];
}
