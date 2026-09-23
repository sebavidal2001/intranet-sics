import { createAdminClient } from "@/lib/supabase/admin";

/**
 * I modelli che l'intranet usa, letti dalla tabella invece che dal codice.
 *
 * La tabella `public.ai_config` la modifica il superadmin dalla sua pagina: qui
 * si legge soltanto. Se la riga non c'è — database non ancora migrato, chiave
 * scritta male — si usa il ripiego dichiarato accanto all'uso, perché un
 * portale che smette di leggere le fatture per una riga mancante in una tabella
 * di configurazione è peggio di uno che usa un modello vecchio.
 */

export interface ConfigAi {
  chiave: string;
  descrizione: string;
  modelloPrimario: string;
  modelloRiserva: string | null;
  parametri: Record<string, unknown>;
  attivo: boolean;
  aggiornatoIl: string | null;
}

/** Gli usi previsti, con il ripiego se la configurazione non risponde. */
export const USI_AI = {
  vettoriLetturaFattura: {
    chiave: "vettori.lettura_fattura",
    descrizione:
      "Lettura delle fatture dei corrieri che arrivano come immagine, senza testo estraibile",
    primario: "google/gemini-3.5-flash-lite",
    riserva: "google/gemini-3.6-flash",
    parametri: { dpi: 200, massimo_pagine: 8, timeout_secondi: 120 },
  },
} as const;

export type UsoAi = keyof typeof USI_AI;

interface RigaConfig {
  chiave: string;
  descrizione: string;
  modello_primario: string;
  modello_riserva: string | null;
  parametri: Record<string, unknown>;
  attivo: boolean;
  aggiornato_il: string | null;
}

function daRipiego(uso: UsoAi): ConfigAi {
  const d = USI_AI[uso];
  return {
    chiave: d.chiave,
    descrizione: d.descrizione,
    modelloPrimario: d.primario,
    modelloRiserva: d.riserva,
    parametri: { ...d.parametri },
    attivo: true,
    aggiornatoIl: null,
  };
}

export async function leggiConfigAi(uso: UsoAi): Promise<ConfigAi> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_config")
    .select("chiave, descrizione, modello_primario, modello_riserva, parametri, attivo, aggiornato_il")
    .eq("chiave", USI_AI[uso].chiave)
    .maybeSingle();

  if (error || !data) return daRipiego(uso);

  const riga = data as unknown as RigaConfig;
  return {
    chiave: riga.chiave,
    descrizione: riga.descrizione,
    modelloPrimario: riga.modello_primario,
    modelloRiserva: riga.modello_riserva,
    parametri: riga.parametri ?? {},
    attivo: riga.attivo,
    aggiornatoIl: riga.aggiornato_il,
  };
}

/** Tutte le configurazioni, per la pagina del superadmin. */
export async function elencoConfigAi(): Promise<ConfigAi[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_config")
    .select("chiave, descrizione, modello_primario, modello_riserva, parametri, attivo, aggiornato_il")
    .order("chiave");
  if (error) throw new Error(`Configurazione AI non leggibile: ${error.message}`);

  return ((data ?? []) as unknown as RigaConfig[]).map((riga) => ({
    chiave: riga.chiave,
    descrizione: riga.descrizione,
    modelloPrimario: riga.modello_primario,
    modelloRiserva: riga.modello_riserva,
    parametri: riga.parametri ?? {},
    attivo: riga.attivo,
    aggiornatoIl: riga.aggiornato_il,
  }));
}

export function numeroParametro(
  config: ConfigAi,
  nome: string,
  ripiego: number
): number {
  const valore = config.parametri[nome];
  return typeof valore === "number" && Number.isFinite(valore) ? valore : ripiego;
}
