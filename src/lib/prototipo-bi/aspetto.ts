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
    if (Object.keys(tabella).length > 0) aspetto.tabella = tabella;
  }

  return Object.keys(aspetto).length > 0 ? aspetto : null;
}

/** Colore fissato per un nome: prima quello del riquadro, poi quello della BU. */
export function coloreFissato(nome: string, aspetto?: AspettoGrafico | null): string | undefined {
  return aspetto?.colori?.[nome] ?? COLORI_BU[nome];
}
