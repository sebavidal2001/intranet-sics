import { createAdminClient } from "@/lib/supabase/admin";
import type { SpedizioneLogica } from "./abbinamento";
import {
  anomalieDi,
  calcolaControlloRiga,
  misureBollaPerSpedizione,
  nuovoContestoControllo,
  type AnomaliaAcquisita,
  type ControlloAcquisito,
} from "./acquisizione";
import type { RigaFattura } from "./fatture/tipi";
import type { Rilevazione } from "./letture";
import { MisureRiga, type MisuraRiga } from "./misure";

/**
 * Ricalcolo dei controlli di una fattura già in archivio.
 *
 * Un controllo è un calcolo, e si rifà quando cambia quello da cui dipende: un
 * listino anticipato, una percentuale carburante trovata dopo, una regola nuova
 * (il fuori misura GLS), le misure inserite dal magazzino. Senza, una
 * correzione ai listini vale solo per le fatture caricate dopo, e le righe
 * «non valutabili» del passato restano tali per sempre.
 *
 * Cosa NON cambia: la fattura e le sue righe (sono il documento), l'aggancio
 * alla bolla (può essere stato confermato a mano), le anomalie su cui una
 * persona ha già deciso o che sono già finite in una contestazione. Si
 * rigenerano solo le anomalie ancora aperte e mai comunicate.
 */

export interface EsitoRicalcolo {
  fatturaId: string;
  vettore: string;
  numero: string;
  righe: number;
  prima: Record<string, number>;
  dopo: Record<string, number>;
  attesoPrima: number;
  attesoDopo: number;
  fatturato: number;
  anomalieRimosse: number;
  anomalieCreate: number;
  cambiate: Array<{ riga: number; prima: string; dopo: string; attesoPrima: number; attesoDopo: number; fatturato: number | null }>;
}

type Riga = Record<string, unknown>;

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const euro = (n: number) => Math.round(n * 100) / 100;

function rigaFattura(r: Riga): RigaFattura {
  return {
    numero: Number(r.riga_numero),
    data: (r.data_spedizione as string | null) ?? null,
    numeroSpedizione: (r.numero_spedizione as string | null) ?? null,
    riferimento: (r.numero_riferimento as string | null) ?? null,
    controparte: (r.controparte_testo as string | null) ?? null,
    direzione: (r.direzione as RigaFattura["direzione"]) ?? null,
    colli: num(r.colli),
    peso: num(r.peso),
    pesoVolumetrico: num(r.peso_volumetrico),
    pesoTassato: num(r.peso_tassato),
    nolo: num(r.nolo),
    supplementi: num(r.supplementi) ?? 0,
    carburante: num(r.carburante) ?? 0,
    totale: num(r.totale),
    dettaglio: { ...((r.dettaglio as Record<string, number | string>) ?? {}) },
  };
}

function spedizioneLogica(s: Riga): SpedizioneLogica {
  return {
    chiave: String(s.id),
    direzione: s.direzione as SpedizioneLogica["direzione"],
    riferimento: (s.numero_riferimento as string | null) ?? null,
    riferimentoNorm: (s.numero_riferimento_norm as string | null) ?? null,
    dataDocumento: (s.data_documento as string | null) ?? null,
    codiceControparte: (s.controparte_codice as string | null) ?? null,
    controparte: (s.controparte_nome as string | null) ?? null,
    zonaCap: (s.zona_cap as string | null) ?? null,
    zonaProvincia: (s.zona_provincia as string | null)?.trim() || null,
    portoCodice: (s.porto_codice as string | null) ?? null,
    porto: (s.porto_descrizione as string | null) ?? null,
    aNostroCarico: (s.a_nostro_carico as boolean | null) ?? null,
    vettoreCodice: null,
    colli: num(s.colli_bolla),
    peso: num(s.peso_bolla),
    volumeMc: null,
    idDocumenti: [],
  };
}

/** Le misure inserite a mano nel controllo, conservate nel dettaglio della riga. */
function misuraDiControllo(dettaglio: Record<string, unknown>): MisuraRiga | undefined {
  const grezzo = dettaglio.misureControllo;
  if (typeof grezzo !== "string") return undefined;
  try {
    const letta = MisureRiga.safeParse(JSON.parse(grezzo));
    return letta.success ? letta.data : undefined;
  } catch {
    return undefined;
  }
}

function conteggio(esiti: Array<string | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of esiti) out[e ?? "senza_controllo"] = (out[e ?? "senza_controllo"] ?? 0) + 1;
  return out;
}

function giorni(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Ricalcola i controlli di una fattura. Con `scrivi: false` calcola e basta:
 * il resoconto dice cosa cambierebbe.
 */
export async function ricalcolaFattura(fatturaId: string, opzioni: { scrivi: boolean }): Promise<EsitoRicalcolo> {
  const admin = createAdminClient();
  const db = () => admin.schema("vettori");

  const { data: fattura, error: fErr } = await db()
    .from("fatture")
    .select("id, numero, vettore_id, vettori(codice)")
    .eq("id", fatturaId)
    .single();
  if (fErr || !fattura) throw new Error(`Fattura ${fatturaId} non trovata: ${fErr?.message ?? ""}`);
  const vettoreCodice = String((fattura.vettori as unknown as { codice: string }).codice);

  const { data: righeDb, error: rErr } = await db()
    .from("fatture_righe")
    .select("*")
    .eq("fattura_id", fatturaId)
    .order("riga_numero");
  if (rErr) throw new Error(`Lettura righe fallita: ${rErr.message}`);
  const righe = (righeDb ?? []) as Riga[];

  const { data: controlliDb, error: cErr } = await db()
    .from("controlli")
    .select("id, fattura_riga_id, spedizione_id, abbinamento, esito, atteso_totale")
    .in("fattura_riga_id", righe.map((r) => String(r.id)));
  if (cErr) throw new Error(`Lettura controlli fallita: ${cErr.message}`);
  const controlloPerRiga = new Map(((controlliDb ?? []) as Riga[]).map((c) => [String(c.fattura_riga_id), c]));

  const spedizioniId = [...new Set(((controlliDb ?? []) as Riga[]).map((c) => c.spedizione_id).filter(Boolean) as string[])];
  const spedizioni = new Map<string, SpedizioneLogica>();
  if (spedizioniId.length) {
    const { data, error } = await db().from("spedizioni").select("*").in("id", spedizioniId);
    if (error) throw new Error(`Lettura spedizioni fallita: ${error.message}`);
    for (const s of (data ?? []) as Riga[]) spedizioni.set(String(s.id), spedizioneLogica(s));
  }
  const misureBolla = await misureBollaPerSpedizione(spedizioniId);

  const date = righe.map((r) => r.data_spedizione as string | null).filter((d): d is string => Boolean(d)).sort();
  let rilevazioni: Rilevazione[] = [];
  if (date.length) {
    const { data, error } = await db()
      .from("rilevazioni")
      .select("*")
      .gte("data_arrivo", giorni(date[0], -7))
      .lte("data_arrivo", giorni(date[date.length - 1], 7))
      .limit(5000);
    if (error) throw new Error(`Lettura rilevazioni fallita: ${error.message}`);
    rilevazioni = (data ?? []) as Rilevazione[];
  }

  const contesto = nuovoContestoControllo(String(fattura.vettore_id), vettoreCodice, rilevazioni);
  const esito: EsitoRicalcolo = {
    fatturaId,
    vettore: vettoreCodice,
    numero: String(fattura.numero),
    righe: righe.length,
    prima: conteggio([...controlloPerRiga.values()].map((c) => String(c.esito))),
    dopo: {},
    attesoPrima: euro([...controlloPerRiga.values()].reduce((t, c) => t + (num(c.atteso_totale) ?? 0), 0)),
    attesoDopo: 0,
    fatturato: euro(righe.reduce((t, r) => t + (num(r.totale) ?? 0), 0)),
    anomalieRimosse: 0,
    anomalieCreate: 0,
    cambiate: [],
  };
  const esitiDopo: string[] = [];

  for (const r of righe) {
    const vecchio = controlloPerRiga.get(String(r.id));
    if (!vecchio) continue;
    const riga = rigaFattura(r);
    const sped = vecchio.spedizione_id ? spedizioni.get(String(vecchio.spedizione_id)) ?? null : null;
    const { controllo, anomalie } = await calcolaControlloRiga(
      riga,
      sped,
      misuraDiControllo(riga.dettaglio),
      vecchio.spedizione_id ? misureBolla.get(String(vecchio.spedizione_id)) ?? [] : [],
      contesto
    );
    if (!controllo) continue;
    esitiDopo.push(controllo.esito);
    esito.attesoDopo += controllo.atteso_totale;
    const attesoPrima = num(vecchio.atteso_totale) ?? 0;
    if (vecchio.esito !== controllo.esito || Math.abs(attesoPrima - controllo.atteso_totale) >= 0.01) {
      esito.cambiate.push({ riga: riga.numero, prima: String(vecchio.esito), dopo: controllo.esito,
        attesoPrima, attesoDopo: controllo.atteso_totale, fatturato: riga.totale });
    }

    const nuoveAnomalie: AnomaliaAcquisita[] = [
      ...anomalieDi(riga, { qualita: vecchio.abbinamento === "nessuno" ? "nessuno" : "numero", spedizione: sped }, controllo),
      ...anomalie,
    ];
    if (opzioni.scrivi) {
      const conteggi = await scriviRiga(String(r.id), String(vecchio.id), (vecchio.spedizione_id as string | null) ?? null, riga, controllo, nuoveAnomalie);
      esito.anomalieRimosse += conteggi.rimosse;
      esito.anomalieCreate += conteggi.create;
    }
  }

  esito.dopo = conteggio(esitiDopo);
  esito.attesoDopo = euro(esito.attesoDopo);
  return esito;
}

async function scriviRiga(
  rigaId: string,
  controlloId: string,
  spedizioneId: string | null,
  riga: RigaFattura,
  controllo: ControlloAcquisito,
  anomalie: AnomaliaAcquisita[]
): Promise<{ rimosse: number; create: number }> {
  const db = () => createAdminClient().schema("vettori");

  const { error: cErr } = await db()
    .from("controlli")
    .update({
      listino_id: controllo.listino_id,
      listino_etichetta: controllo.listino_etichetta,
      zona_codice: controllo.zona_codice,
      perc_adeguamento: controllo.perc_adeguamento,
      perc_carburante: controllo.perc_carburante,
      peso_reale: controllo.peso_reale,
      peso_volumetrico: controllo.peso_volumetrico,
      peso_tassabile: controllo.peso_tassabile,
      peso_applicato: controllo.peso_applicato,
      atteso_nolo: controllo.atteso_nolo,
      atteso_imponibile: controllo.atteso_imponibile,
      atteso_adeguamento: controllo.atteso_adeguamento,
      atteso_carburante: controllo.atteso_carburante,
      atteso_fuori_base: controllo.atteso_fuori_base,
      atteso_totale: controllo.atteso_totale,
      atteso_dettaglio: controllo.atteso_dettaglio,
      scostamento: controllo.scostamento,
      esito: controllo.esito,
      avvertenze: controllo.avvertenze,
      calcolato_il: new Date().toISOString(),
    })
    .eq("id", controlloId);
  if (cErr) throw new Error(`Aggiornamento controllo fallito: ${cErr.message}`);

  const { error: dErr } = await db().from("fatture_righe").update({ dettaglio: riga.dettaglio }).eq("id", rigaId);
  if (dErr) throw new Error(`Aggiornamento riga fallito: ${dErr.message}`);

  // Le anomalie decise o comunicate restano: sono il lavoro di una persona.
  const { data: rimosse, error: rmErr } = await db()
    .from("anomalie")
    .delete()
    .eq("controllo_id", controlloId)
    .eq("stato", "aperta")
    .is("comunicazione_id", null)
    .select("id");
  if (rmErr) throw new Error(`Pulizia anomalie fallita: ${rmErr.message}`);

  const { data: restanti, error: reErr } = await db().from("anomalie").select("tipo").eq("controllo_id", controlloId);
  if (reErr) throw new Error(`Lettura anomalie fallita: ${reErr.message}`);
  const giaDecise = new Set(((restanti ?? []) as Array<{ tipo: string }>).map((a) => a.tipo));
  const daCreare = anomalie.filter((a) => !giaDecise.has(a.tipo));
  if (daCreare.length) {
    const { error: inErr } = await db().from("anomalie").insert(daCreare.map((a) => ({
      controllo_id: controlloId,
      spedizione_id: spedizioneId,
      tipo: a.tipo,
      gravita: a.gravita,
      descrizione: a.descrizione,
      importo_contestato: a.importo,
    })));
    if (inErr) throw new Error(`Scrittura anomalie fallita: ${inErr.message}`);
  }
  return { rimosse: (rimosse ?? []).length, create: daCreare.length };
}
