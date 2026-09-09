import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lo storico delle spedizioni controllate.
 *
 * È l'archivio che nei fogli erano i due elenchi «partenze» e «arrivi»: la
 * schermata di acquisizione mostra una fattura mentre la si carica e poi
 * sparisce, questo si riapre a distanza di mesi. Vedi la migration 095 per il
 * perché la direzione sia un filtro e non una colonna.
 */

const SCHEMA = "vettori";

export type Direzione = "entrata" | "uscita";

export interface RigaStorico {
  id: string;
  fattura_id: string;
  direzione: Direzione | null;
  vettore_codice: string;
  vettore_nome: string;
  fattura_numero: string | null;
  data_fattura: string | null;
  anno: number | null;
  mese: number | null;
  stato_fattura: string;
  riga_numero: number;
  data_spedizione: string | null;
  numero_spedizione: string | null;
  riferimento: string | null;
  controparte: string | null;
  controparte_codice: string | null;
  provincia: string | null;
  cap: string | null;
  porto_descrizione: string | null;
  a_nostro_carico: boolean | null;
  colli: number | null;
  peso: number | null;
  peso_volumetrico: number | null;
  peso_tassato: number | null;
  nolo: number | null;
  supplementi: number | null;
  adeguamento: number | null;
  carburante: number | null;
  fatturato: number | null;
  atteso: number | null;
  scostamento: number | null;
  esito: "in_linea" | "da_verificare" | "anomalia" | "non_valutabile";
  abbinamento: "numero" | "assistito" | "manuale" | "nessuno";
  listino: string | null;
  zona: string | null;
  peso_applicato: string | null;
  avvertenze: string[] | null;
  anomalie: number;
  anomalie_aperte: number;
}

export interface TotaliStorico {
  righe: number;
  righe_valide: number;
  righe_bozza: number;
  colli: number;
  kg: number;
  fatturato: number;
  atteso: number;
  anomalie: number;
  con_anomalie_aperte: number;
}

export interface EsitoStorico {
  righe: RigaStorico[];
  totali: TotaliStorico;
  /** Quante righe per direzione, calcolate ignorando il filtro di direzione. */
  per_direzione: Record<string, number> | null;
  pagina: number;
  per_pagina: number;
}

export interface FiltriStorico {
  direzione?: Direzione | null;
  vettori?: string[] | null;
  da?: string | null;
  a?: string | null;
  anno?: number | null;
  mese?: number | null;
  esiti?: string[] | null;
  abbinamenti?: string[] | null;
  province?: string[] | null;
  cerca?: string | null;
  soloAnomalie?: boolean;
  pesoMin?: number | null;
  pesoMax?: number | null;
  importoMin?: number | null;
  importoMax?: number | null;
  scostamentoMin?: number | null;
  ordine?: string | null;
  pagina?: number;
  perPagina?: number;
}

/** Un array vuoto non è un filtro: azzerarlo evita di non trovare mai niente. */
const lista = (v: string[] | null | undefined) => (v && v.length > 0 ? v : null);

export async function elencoSpedizioni(f: FiltriStorico = {}): Promise<EsitoStorico> {
  const admin = createAdminClient();
  const { data, error } = await admin.schema(SCHEMA).rpc("elenco_spedizioni", {
    p_direzione: f.direzione ?? null,
    p_vettori: lista(f.vettori),
    p_da: f.da || null,
    p_a: f.a || null,
    p_anno: f.anno ?? null,
    p_mese: f.mese ?? null,
    p_esiti: lista(f.esiti),
    p_abbinamenti: lista(f.abbinamenti),
    p_province: lista(f.province),
    p_cerca: f.cerca?.trim() || null,
    p_solo_anomalie: f.soloAnomalie ?? false,
    p_peso_min: f.pesoMin ?? null,
    p_peso_max: f.pesoMax ?? null,
    p_importo_min: f.importoMin ?? null,
    p_importo_max: f.importoMax ?? null,
    p_scostamento_min: f.scostamentoMin ?? null,
    p_ordine: f.ordine || "data_desc",
    p_pagina: f.pagina ?? 1,
    p_per_pagina: f.perPagina ?? 100,
  });
  if (error) throw new Error(`Lettura storico fallita: ${error.message}`);
  return data as EsitoStorico;
}

export interface ValoriFiltro {
  vettori: Array<{ codice: string; nome: string }>;
  province: string[];
  periodi: Array<{ anno: number; mese: number }>;
  anni: number[];
}

export async function valoriFiltro(): Promise<ValoriFiltro> {
  const admin = createAdminClient();
  const { data, error } = await admin.schema(SCHEMA).rpc("filtri_spedizioni");
  if (error) throw new Error(`Lettura filtri fallita: ${error.message}`);
  return data as ValoriFiltro;
}

/* ------------------------------------------------------------------ */
/*  Esportazione                                                       */
/* ------------------------------------------------------------------ */

const INTESTAZIONI = [
  "Direzione", "Data spedizione", "Vettore", "Fattura", "Data fattura",
  "Riferimento", "N. spedizione", "Controparte", "Codice controparte",
  "Provincia", "CAP", "Porto", "Colli", "Peso reale", "Peso volumetrico",
  "Peso tassato", "Peso applicato", "Nolo", "Supplementi", "Adeguamento",
  "Carburante", "Fatturato", "Atteso", "Differenza", "Scostamento %",
  "Esito", "Abbinamento", "Listino", "Zona", "Anomalie aperte", "Stato fattura",
];

/**
 * Lo storico in CSV, per chi il foglio lo vuole ancora.
 *
 * Separatore `;` e virgola decimale: è quello che Excel italiano apre con un
 * doppio clic. Con la virgola come separatore aprirebbe tutto in una colonna, e
 * la prima cosa che farebbe chi riceve il file è chiedere perché.
 */
export function versoCsv(righe: RigaStorico[]): string {
  const num = (n: number | null | undefined, d = 2) =>
    n == null ? "" : n.toFixed(d).replace(".", ",");

  const campo = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const corpo = righe.map((r) =>
    [
      r.direzione === "entrata" ? "Arrivo" : r.direzione === "uscita" ? "Partenza" : "",
      r.data_spedizione ?? "",
      r.vettore_nome,
      r.fattura_numero ?? "",
      r.data_fattura ?? "",
      r.riferimento ?? "",
      r.numero_spedizione ?? "",
      r.controparte ?? "",
      r.controparte_codice ?? "",
      r.provincia ?? "",
      r.cap ?? "",
      r.porto_descrizione ?? "",
      r.colli ?? "",
      num(r.peso, 3),
      num(r.peso_volumetrico, 3),
      num(r.peso_tassato, 3),
      r.peso_applicato ?? "",
      num(r.nolo),
      num(r.supplementi),
      num(r.adeguamento),
      num(r.carburante),
      num(r.fatturato),
      num(r.atteso),
      r.fatturato != null && r.atteso != null ? num(r.fatturato - r.atteso) : "",
      r.scostamento != null ? num(r.scostamento * 100, 1) : "",
      r.esito,
      r.abbinamento,
      r.listino ?? "",
      r.zona ?? "",
      r.anomalie_aperte,
      r.stato_fattura,
    ]
      .map(campo)
      .join(";")
  );

  // Il BOM serve: senza, Excel legge il file come ANSI e gli accenti si
  // rompono nella prima colonna che ne contiene uno.
  return `﻿${INTESTAZIONI.join(";")}\n${corpo.join("\n")}\n`;
}
