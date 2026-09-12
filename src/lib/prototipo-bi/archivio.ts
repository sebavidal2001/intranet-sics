/**
 * ARCHIVIO — dove vive lo stato del BI.
 *
 * Due destinazioni diverse, e la distinzione conta:
 *
 *   CONFIGURAZIONE -> PostgreSQL, schema `bi_direzionale` (migration 102).
 *     Budget, BEP, chiusure aziendali, incidenze, budget commerciali, serie
 *     importate, briefing, riscontri. Sono dati inseriti da persone, che non
 *     si possono ricostruire se si perdono. Stavano in file JSON dentro la
 *     cartella del repo: il deploy sulla VM fa `git reset --hard origin/main`,
 *     quindi erano a un deploy di distanza dalla sparizione.
 *
 *   CACHE E DOCUMENTI -> file su disco, come prima.
 *     Lo snapshot dei dati (~66.000 righe, riscritto ogni sei ore) e i file
 *     Word/Excel prodotti dall'analista. In Postgres lo snapshot sarebbe un
 *     jsonb da decine di MB riscritto per intero a ogni giro, per un dato che
 *     e' derivato e ricostruibile in tre secondi.
 *
 * L'interfaccia pubblica e' rimasta identica a quella su file: nessun
 * chiamante e' cambiato.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConfigurazioneAnno, Briefing, SerieBudget } from "./tipi";

const SCHEMA = "bi_direzionale";

/** Client sullo schema del BI. Service role: le route hanno gia' verificato il livello. */
function db() {
  return createAdminClient().schema(SCHEMA);
}

/**
 * Uno schema non elencato in `pgrst.db_schemas` fa tornare le query VUOTE
 * SENZA ERRORE, e il sintomo — "nessun budget configurato" con la tabella
 * piena — manda a cercare il bug nel codice. La 102 lo aggiunge all'elenco,
 * ma su Supabase gestito l'interfaccia web puo' sovrascriverlo.
 *
 * Qui si distingue il caso: se PostgREST non conosce lo schema risponde con un
 * errore riconoscibile, e lo si traduce in un messaggio che dice cosa fare.
 */
function traduciErrore(e: { message?: string; code?: string } | null): string | null {
  if (!e) return null;
  const m = e.message ?? "";
  if (/schema must be one of|does not exist.*schema|PGRST106/i.test(m)) {
    return (
      `Lo schema "${SCHEMA}" non è esposto a PostgREST: le query tornerebbero vuote senza errore. ` +
      `Aggiungerlo a pgrst.db_schemas (migration 102) e ricaricare la configurazione.`
    );
  }
  if (/relation .* does not exist/i.test(m)) {
    return `Tabelle del BI non presenti: applicare le migration 102-104. (${m})`;
  }
  return m || "Errore database";
}

function esplodi(e: { message?: string; code?: string } | null): void {
  const messaggio = traduciErrore(e);
  if (messaggio) throw new Error(messaggio);
}

// ── Configurazione budget/BEP per anno ──────────────────────────────────────

export async function leggiConfigurazione(
  anno: number
): Promise<ConfigurazioneAnno | null> {
  const sb = db();

  const { data: testata, error } = await sb
    .from("configurazione_anno")
    .select("*")
    .eq("anno", anno)
    .maybeSingle();
  esplodi(error);
  if (!testata) return null;

  // Le tre liste si chiedono insieme: sono indipendenti fra loro.
  const [chiusure, incidenze, commerciali] = await Promise.all([
    sb.from("chiusure").select("*").eq("anno", anno).order("dal"),
    sb.from("incidenze_bu").select("*").eq("anno", anno),
    sb.from("budget_commerciali").select("*").eq("anno", anno),
  ]);
  esplodi(chiusure.error);
  esplodi(incidenze.error);
  esplodi(commerciali.error);

  return {
    anno: testata.anno,
    budgetAnnuo: Number(testata.budget_annuo) || 0,
    bepAnnuo: Number(testata.bep_annuo) || 0,
    modalita: testata.modalita,
    escludiWeekend: Boolean(testata.escludi_weekend),
    aggiornatoIl: testata.aggiornato_il,
    chiusure: (chiusure.data ?? []).map((c) => ({
      id: c.id,
      dal: c.dal,
      al: c.al,
      descrizione: c.descrizione,
    })),
    incidenzeBU: (incidenze.data ?? []).map((i) => ({
      bu: i.bu,
      pesoPct: Number(i.peso_pct) || 0,
    })),
    commerciali: (commerciali.data ?? []).map((c) => ({
      codiceAgente: c.codice_agente,
      agente: c.agente,
      quotaPct: Number(c.quota_pct) || 0,
      importoAnnuo: c.importo_annuo === null ? null : Number(c.importo_annuo),
      bu: c.bu,
    })),
  };
}

/**
 * Salva l'anno intero in UNA transazione, via RPC.
 *
 * Quattro tabelle, quattro chiamate separate, e la seconda che fallisce dopo
 * la prima: le chiusure verrebbero cancellate e non reinserite, con la testata
 * gia' aggiornata. Agosto — due settimane senza un ordine — tornerebbe a
 * essere letto come un crollo del 100%, e il briefing lo direbbe alla
 * direzione come notizia del giorno.
 */
export async function salvaConfigurazione(
  config: ConfigurazioneAnno,
  utenteId?: string
) {
  const { error } = await createAdminClient().rpc("salva_configurazione", {
    p_dati: config as unknown as Record<string, unknown>,
    p_utente: utenteId ?? null,
  });
  if (error) {
    if (/function .* does not exist|schema cache/i.test(error.message)) {
      throw new Error(
        "Funzione bi_direzionale.salva_configurazione assente: applicare la migration 102."
      );
    }
    esplodi(error);
  }
}

export async function anniConfigurati(): Promise<number[]> {
  const { data, error } = await db()
    .from("configurazione_anno")
    .select("anno")
    .order("anno", { ascending: false });
  esplodi(error);
  return (data ?? []).map((r) => r.anno);
}

// ── Serie budget importate dagli Excel aziendali ───────────────────────────

export async function leggiSerieBudget(anno: number): Promise<SerieBudget | null> {
  const { data, error } = await db()
    .from("serie_budget")
    .select("*")
    .eq("anno", anno)
    .maybeSingle();
  esplodi(error);
  if (!data) return null;

  return {
    origine: data.origine,
    formato: data.formato,
    importatoIl: data.importato_il,
    anni: [data.anno],
    totaliPerAnno: {
      [data.anno]: {
        budget: Number(data.totale_budget) || 0,
        bep: Number(data.totale_bep) || 0,
      },
    },
    righe: Array.isArray(data.righe) ? data.righe : [],
  };
}

export async function salvaSerieBudget(
  anno: number,
  serie: SerieBudget,
  utenteId?: string
) {
  const totali = serie.totaliPerAnno?.[anno] ?? { budget: 0, bep: 0 };
  const { error } = await db()
    .from("serie_budget")
    .upsert(
      {
        anno,
        origine: serie.origine,
        formato: serie.formato ?? "",
        importato_il: serie.importatoIl ?? new Date().toISOString(),
        totale_budget: totali.budget ?? 0,
        totale_bep: totali.bep ?? 0,
        righe: serie.righe ?? [],
        importato_da: utenteId ?? null,
      },
      { onConflict: "anno" }
    );
  esplodi(error);
}

export async function eliminaSerieBudget(anno: number) {
  const { error } = await db().from("serie_budget").delete().eq("anno", anno);
  esplodi(error);
}

export async function anniConSerie(): Promise<number[]> {
  const { data, error } = await db()
    .from("serie_budget")
    .select("anno")
    .order("anno", { ascending: false });
  esplodi(error);
  return (data ?? []).map((r) => r.anno);
}

// ── Cache dello snapshot dati (resta su FILE) ───────────────────────────────
//
// Non va in database: e' un derivato di ~66.000 righe riscritto ogni sei ore e
// ricostruibile in tre secondi dalle viste.

const RADICE = path.join(process.cwd(), "prototipo-bi", "dati");
const CARTELLA_CACHE = path.join(RADICE, "cache");

export const FILE_SNAPSHOT = path.join(CARTELLA_CACHE, "snapshot.json");

export async function leggiSnapshotDaCache<T>(): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(FILE_SNAPSHOT, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function salvaSnapshotInCache(snapshot: unknown) {
  await fs.mkdir(CARTELLA_CACHE, { recursive: true });
  // Scrittura atomica: prima su temporaneo, poi rename.
  const tmp = `${FILE_SNAPSHOT}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snapshot), "utf8");
  await fs.rename(tmp, FILE_SNAPSHOT);
}

export async function etaSnapshot(): Promise<number | null> {
  try {
    const st = await fs.stat(FILE_SNAPSHOT);
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

// ── Briefing archiviati (per il cooldown e lo storico) ──────────────────────

export async function leggiBriefingArchiviati(): Promise<Briefing[]> {
  const { data, error } = await db()
    .from("briefing")
    .select("contenuto")
    .order("generato_il", { ascending: false })
    .limit(60);
  esplodi(error);
  return (data ?? []).map((r) => r.contenuto as Briefing);
}

export async function archiviaBriefing(briefing: Briefing, destinatarioId?: string) {
  const { error } = await db().from("briefing").insert({
    generato_il: briefing.generatoIl,
    data_riferimento: briefing.dataRiferimento,
    destinatario_id: destinatarioId ?? null,
    ruolo: briefing.ruolo,
    motore: briefing.motoreAI,
    contenuto: briefing,
    segnali_valutati: briefing.segnaliValutati ?? 0,
  });
  esplodi(error);
}

// ── Riscontro degli utenti sulle voci del briefing ──────────────────────────

export interface Riscontro {
  segnaleId: string;
  famiglia: string;
  utile: boolean;
  nota?: string;
  registratoIl: string;
}

export async function leggiRiscontri(): Promise<Riscontro[]> {
  const { data, error } = await db()
    .from("riscontri")
    .select("segnale_id, famiglia, utile, nota, registrato_il")
    .order("registrato_il", { ascending: false })
    .limit(500);
  esplodi(error);
  return (data ?? []).map((r) => ({
    segnaleId: r.segnale_id,
    famiglia: r.famiglia,
    utile: r.utile,
    nota: r.nota ?? undefined,
    registratoIl: r.registrato_il,
  }));
}

export async function registraRiscontro(riscontro: Riscontro, utenteId?: string) {
  const { error } = await db().from("riscontri").insert({
    segnale_id: riscontro.segnaleId,
    famiglia: riscontro.famiglia,
    utile: riscontro.utile,
    nota: riscontro.nota ?? null,
    utente_id: utenteId ?? null,
    registrato_il: riscontro.registratoIl ?? new Date().toISOString(),
  });
  esplodi(error);
}

/**
 * Peso per famiglia di rilevatore, derivato dai riscontri.
 * È il minimo indispensabile per far sì che il sistema impari a tacere:
 * una famiglia bocciata ripetutamente perde punteggio.
 */
export async function pesiDaRiscontri(): Promise<Record<string, number>> {
  const riscontri = await leggiRiscontri();
  const conteggi: Record<string, { utili: number; totale: number }> = {};
  for (const r of riscontri) {
    conteggi[r.famiglia] ??= { utili: 0, totale: 0 };
    conteggi[r.famiglia].totale += 1;
    if (r.utile) conteggi[r.famiglia].utili += 1;
  }
  const pesi: Record<string, number> = {};
  for (const [famiglia, c] of Object.entries(conteggi)) {
    if (c.totale < 3) continue; // troppo pochi riscontri per concludere
    // Da 0.5 (mai utile) a 1.5 (sempre utile).
    pesi[famiglia] = 0.5 + c.utili / c.totale;
  }
  return pesi;
}

// ── Documenti prodotti dall'analista (restano FILE) ──────────────────────────

export const CARTELLA_DOCUMENTI = path.join(RADICE, "documenti");

export async function assicuraCartellaDocumenti() {
  await fs.mkdir(CARTELLA_DOCUMENTI, { recursive: true });
  return CARTELLA_DOCUMENTI;
}

export async function elencaDocumenti() {
  try {
    const files = await fs.readdir(CARTELLA_DOCUMENTI);
    const out = [];
    for (const f of files) {
      const st = await fs.stat(path.join(CARTELLA_DOCUMENTI, f));
      out.push({ nome: f, byte: st.size, creatoIl: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.creatoIl.localeCompare(a.creatoIl));
  } catch {
    return [];
  }
}
