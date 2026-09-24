import { createAdminClient } from "@/lib/supabase/admin";
import {
  addebitoCliente,
  caricaAccordiRiaddebito,
  caricaTuttiGliScaglioni,
} from "@/lib/portali/vettori/riaddebito";
import type {
  EsitoStorico,
  FiltriStorico,
  RigaStorico,
  ValoriFiltroStorico,
} from "@/lib/portali/vettori/tipi";

export type {
  EsitoStorico,
  FiltriStorico,
  RigaStorico,
  ValoriFiltroStorico,
} from "@/lib/portali/vettori/tipi";

/**
 * Lo storico delle spedizioni registrate, fatturate o ancora da fatturare.
 *
 * È l'archivio che nei fogli erano i due elenchi «partenze» e «arrivi»: la
 * schermata di acquisizione mostra una fattura mentre la si carica e poi
 * sparisce, questo si riapre a distanza di mesi. Dalla migration 098 include
 * anche le spedizioni che non hanno ancora una riga di fattura agganciata.
 */

const SCHEMA = "vettori";

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
  const esito = data as EsitoStorico;

  // L'addebito al cliente si calcola qui e non in SQL: le regole (scaglioni,
  // accordi per cliente, importo fissato in simulazione) sono gia' scritte e
  // testate in `riaddebito.ts`, e riscriverle in SQL vorrebbe dire tenerne due
  // copie. Due letture in piu' per pagina, non per riga.
  if (esito.righe.some((riga) => riga.direzione === "uscita")) {
    const [scaglioni, accordi] = await Promise.all([
      caricaTuttiGliScaglioni(),
      caricaAccordiRiaddebito(),
    ]);
    esito.righe = esito.righe.map((riga) => ({
      ...riga,
      addebito_cliente: addebitoCliente(riga, scaglioni, accordi),
    }));
  }
  return esito;
}

/**
 * La spunta «addebito verificato in fatturazione».
 *
 * Si mette sulla spedizione, non sulla riga di fattura: e' la bolla che si
 * fattura al cliente, e una spedizione ancora senza fattura del vettore si
 * puo' gia' verificare. La colonna non e' fra quelle che il congelamento
 * protegge, quindi funziona anche sulle bolle agganciate a una fattura.
 */
export async function segnaAddebitoVerificato(
  spedizioneId: string,
  verificato: boolean,
  utenteId: string
): Promise<{ verificatoIl: string | null }> {
  const admin = createAdminClient();
  const verificatoIl = verificato ? new Date().toISOString() : null;
  const { data, error } = await admin
    .schema(SCHEMA)
    .from("spedizioni")
    .update({
      riaddebito_verificato_il: verificatoIl,
      riaddebito_verificato_da: verificato ? utenteId : null,
    })
    .eq("id", spedizioneId)
    .select("id");
  if (error) throw new Error(`Spunta non salvata: ${error.message}`);
  if ((data ?? []).length === 0) throw new Error("Spedizione non trovata.");
  return { verificatoIl };
}

export async function valoriFiltro(): Promise<ValoriFiltroStorico> {
  const admin = createAdminClient();
  const { data, error } = await admin.schema(SCHEMA).rpc("filtri_spedizioni");
  if (error) throw new Error(`Lettura filtri fallita: ${error.message}`);
  return data as ValoriFiltroStorico;
}

/* ------------------------------------------------------------------ */
/*  Esportazione                                                       */
/* ------------------------------------------------------------------ */

const INTESTAZIONI = [
  "Direzione", "Data spedizione", "Vettore", "Origine", "Fattura", "Data fattura",
  "Riferimento", "N. spedizione", "Controparte", "Codice controparte",
  "Provincia", "CAP", "Porto", "Colli", "Peso reale", "Peso volumetrico",
  "Peso tassato", "Peso applicato", "Nolo", "Supplementi", "Adeguamento",
  "Carburante", "Fatturato", "Atteso", "Differenza", "Scostamento %",
  "Esito", "Abbinamento", "Listino", "Zona", "Anomalie aperte", "Stato fatturazione", "Stato fattura",
  "Protocollo BF", "Addebito cliente", "Fonte addebito", "Addebito verificato il", "Fattura quadrata",
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
      r.vettore_nome ?? "",
      r.origine === "excel_storico"
        ? "Excel storico"
        : r.origine === "gestionale"
          ? "Gestionale"
          : r.origine === "manuale"
            ? "Manuale"
            : "",
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
      r.esito ?? "",
      r.abbinamento ?? "",
      r.listino ?? "",
      r.zona ?? "",
      r.anomalie_aperte,
      r.stato_fatturazione === "non_fatturata"
        ? "Non ancora fatturata"
        : r.stato_fatturazione === "bozza"
          ? "Fattura in bozza"
          : "Fatturata",
      r.stato_fattura ?? "",
      r.numero_protocollo ?? "",
      num(r.addebito_cliente?.importo),
      r.addebito_cliente ? r.addebito_cliente.regola : "",
      r.riaddebito_verificato_il?.slice(0, 10) ?? "",
      r.fattura_quadrata === false ? "No" : r.fattura_quadrata === true ? "Sì" : "",
    ]
      .map(campo)
      .join(";")
  );

  // Il BOM serve: senza, Excel legge il file come ANSI e gli accenti si
  // rompono nella prima colonna che ne contiene uno.
  return `﻿${INTESTAZIONI.join(";")}\n${corpo.join("\n")}\n`;
}
