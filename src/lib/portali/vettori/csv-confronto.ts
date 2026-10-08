export interface RigaConfrontoCsv {
  riga_numero: number;
  data: string | null;
  riferimento: string | null;
  numero_spedizione: string | null;
  controparte: string | null;
  direzione: string | null;
  peso: number | null;
  peso_tassato: number | null;
  nolo: number | null;
  supplementi: number;
  carburante: number;
  totale: number | null;
  abbinamento: "numero" | "assistito" | "nessuno";
  motivo_abbinamento: string;
  controllo: {
    peso_reale: number | null;
    peso_tassabile: number | null;
    atteso_totale: number;
    esito: string;
  } | null;
}

export interface TotaliConfrontoCsv {
  spedizioni: number | null;
  peso: number | null;
  nolo: number | null;
  supplementi: number | null;
  carburante: number | null;
  totaleDocumento: number | null;
  totaleRighe?: number | null;
}

const INTESTAZIONI = [
  "N.",
  "Data",
  "Bolla/riferimento",
  "Numero spedizione/AWB",
  "Controparte",
  "Direzione",
  "Peso reale",
  "Peso tassabile",
  "Nolo fatturato",
  "Supplementi",
  "Carburante",
  "Totale fatturato",
  "Atteso totale",
  "Differenza",
  "Esito",
  "Motivo aggancio",
] as const;

const esitoItaliano = (esito: string | null | undefined): string =>
  ({
    in_linea: "In linea",
    da_verificare: "Da verificare",
    anomalia: "Anomalia",
    non_valutabile: "Dati da completare",
  })[esito ?? ""] ?? "Dati da completare";

const numero = (valore: number | null | undefined, decimali: number): string =>
  valore == null || !Number.isFinite(valore)
    ? ""
    : valore.toFixed(decimali).replace(".", ",");

const campo = (valore: string | number | null | undefined): string => {
  const testo = valore == null ? "" : String(valore);
  return /[";\r\n]/.test(testo) ? `"${testo.replace(/"/g, '""')}"` : testo;
};

const somma = (
  righe: RigaConfrontoCsv[],
  leggi: (riga: RigaConfrontoCsv) => number | null | undefined
): number => Math.round(righe.reduce((totale, riga) => totale + (leggi(riga) ?? 0), 0) * 100) / 100;

/** Confronto riga-per-riga pronto per Excel in italiano. */
export function generaCsvConfronto(
  righe: RigaConfrontoCsv[],
  dichiarati: TotaliConfrontoCsv
): string {
  const record = righe.map((riga) => {
    const atteso = riga.controllo?.atteso_totale ?? null;
    const differenza = riga.totale != null && atteso != null ? riga.totale - atteso : null;
    return [
      riga.riga_numero,
      riga.data,
      riga.riferimento,
      riga.numero_spedizione,
      riga.controparte,
      riga.direzione === "entrata" ? "Arrivo" : riga.direzione === "uscita" ? "Partenza" : "Da classificare",
      numero(riga.controllo?.peso_reale ?? riga.peso, 3),
      numero(riga.controllo?.peso_tassabile ?? riga.peso_tassato, 3),
      numero(riga.nolo, 2),
      numero(riga.supplementi, 2),
      numero(riga.carburante, 2),
      numero(riga.totale, 2),
      numero(atteso, 2),
      numero(differenza, 2),
      esitoItaliano(riga.controllo?.esito),
      riga.motivo_abbinamento,
    ].map(campo).join(";");
  });

  const totaleFatturato = somma(righe, (riga) => riga.totale);
  const totaleAtteso = somma(righe, (riga) => riga.controllo?.atteso_totale);
  const riepilogoRighe = [
    "Totali delle righe",
    righe.length,
    "",
    "",
    "",
    "",
    numero(somma(righe, (riga) => riga.controllo?.peso_reale ?? riga.peso), 3),
    numero(somma(righe, (riga) => riga.controllo?.peso_tassabile ?? riga.peso_tassato), 3),
    numero(somma(righe, (riga) => riga.nolo), 2),
    numero(somma(righe, (riga) => riga.supplementi), 2),
    numero(somma(righe, (riga) => riga.carburante), 2),
    numero(totaleFatturato, 2),
    numero(totaleAtteso, 2),
    numero(totaleFatturato - totaleAtteso, 2),
    "",
    "",
  ].map(campo).join(";");
  const riepilogoDichiarato = [
    "Totali dichiarati in fattura",
    dichiarati.spedizioni ?? "",
    "",
    "",
    "",
    "",
    numero(dichiarati.peso, 3),
    "",
    numero(dichiarati.nolo, 2),
    numero(dichiarati.supplementi, 2),
    numero(dichiarati.carburante, 2),
    numero(dichiarati.totaleRighe ?? dichiarati.totaleDocumento, 2),
    "",
    "",
    "",
    "",
  ].map(campo).join(";");

  return `\uFEFF${INTESTAZIONI.join(";")}\r\n${record.join("\r\n")}\r\n\r\n${riepilogoRighe}\r\n${riepilogoDichiarato}\r\n`;
}
