import { createAdminClient } from "@/lib/supabase/admin";
import { chiediVisione } from "@/lib/ai/openrouter";
import { nomiCompatibili } from "./abbinamento";
import { normalizzaRiferimento } from "./fatture/testo";

/**
 * Aggancio fattura -> bolla con l'aiuto di un modello.
 *
 * Il codice fa quello che sa fare bene, cioè cercare: per ogni riga di fattura
 * senza bolla raccoglie poche candidate (stesso verso, data vicina, numero
 * uguale o "nudo", nome compatibile). Il modello fa quello che il codice fa
 * male, cioè giudicare: «SM VIGNOLA» in fattura e «ATLANTA spa» in bolla con lo
 * stesso numero, la stessa data e lo stesso peso sono la stessa spedizione
 * (Trading Post stampa il punto di consegna, il gestionale il cliente), e
 * «694DTV» è la BF 694 di OLAB. Una regola fissa o le unisce sempre o mai.
 *
 * Il modello sceglie SOLO fra le candidate, identificate da un'etichetta corta
 * (C1, C2...): non puo' inventare una bolla. La risposta si salva in
 * `vettori.agganci_proposti` e si paga una volta: applicarla e' un passo
 * separato che non richiama il modello.
 */

export const MODELLO_AGGANCIO_PREDEFINITO = "openai/gpt-6-luna";
const GIORNI_FINESTRA = 10;
const MASSIMO_CANDIDATI = 8;

export interface RigaDaAgganciare {
  controlloId: string;
  rigaId: string;
  vettore: string;
  fattura: string;
  rigaNumero: number;
  data: string | null;
  direzione: "entrata" | "uscita" | null;
  riferimento: string | null;
  controparte: string | null;
  provincia: string | null;
  colli: number | null;
  peso: number | null;
  pesoTassato: number | null;
  totale: number | null;
}

export interface Candidata {
  etichetta: string;
  spedizioneId: string;
  numero: string | null;
  protocollo: string | null;
  data: string;
  controparte: string | null;
  localita: string | null;
  provincia: string | null;
  colli: number | null;
  peso: number | null;
  vettore: string | null;
  profilo: string | null;
  origine: string;
  giaAgganciataA: number;
  indizi: string[];
}

export interface PropostaAggancio {
  esito: "scelta" | "nessuna" | "senza_candidati" | "errore";
  spedizioneId: string | null;
  sicurezza: "alta" | "media" | "bassa" | null;
  motivo: string;
  candidati: Candidata[];
  modello: string | null;
  tokenIngresso: number | null;
  tokenUscita: number | null;
  costo: number | null;
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** Le cifre del numero, senza zeri davanti: «694DTV» -> «694», «0020147» -> «20147». */
export function cifre(v: string | null | undefined): string | null {
  const c = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return c.length >= 3 ? c : null;
}

/**
 * Due numeri si somigliano se le cifre coincidono o se una contiene l'altra in
 * coda: «260020147» (anno 26 + 0020147) finisce con «20147». Le code corte
 * («2», «12») non contano: troppe bolle le condividono.
 */
export function numeroSomigliante(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = cifre(a);
  const y = cifre(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

function giorni(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function distanza(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
}

/** Le righe di fattura senza bolla agganciata. */
export async function righeDaAgganciare(): Promise<RigaDaAgganciare[]> {
  const db = createAdminClient().schema("vettori");
  const { data: controlli, error } = await db
    .from("controlli")
    .select("id, fattura_riga_id")
    .is("spedizione_id", null);
  if (error) throw new Error(`Lettura controlli fallita: ${error.message}`);
  const perRiga = new Map(((controlli ?? []) as Array<{ id: string; fattura_riga_id: string }>).map((c) => [c.fattura_riga_id, c.id]));

  const righe: RigaDaAgganciare[] = [];
  const ids = [...perRiga.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: rErr } = await db
      .from("fatture_righe")
      .select("id, riga_numero, data_spedizione, direzione, numero_riferimento, controparte_testo, colli, peso, peso_tassato, totale, dettaglio, fatture(numero, vettori(codice))")
      .in("id", ids.slice(i, i + 100));
    if (rErr) throw new Error(`Lettura righe fallita: ${rErr.message}`);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const fattura = r.fatture as { numero: string; vettori: { codice: string } };
      const dettaglio = (r.dettaglio ?? {}) as Record<string, unknown>;
      righe.push({
        controlloId: perRiga.get(String(r.id))!,
        rigaId: String(r.id),
        vettore: fattura.vettori.codice,
        fattura: fattura.numero,
        rigaNumero: Number(r.riga_numero),
        data: (r.data_spedizione as string | null) ?? null,
        direzione: (r.direzione as RigaDaAgganciare["direzione"]) ?? null,
        riferimento: (r.numero_riferimento as string | null) ?? null,
        controparte: (r.controparte_testo as string | null) ?? null,
        provincia: typeof dettaglio.provincia === "string" ? dettaglio.provincia : null,
        colli: num(r.colli),
        peso: num(r.peso),
        pesoTassato: num(r.peso_tassato),
        totale: num(r.totale),
      });
    }
  }
  return righe.sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "") || a.rigaNumero - b.rigaNumero);
}

/** Le bolle fra cui il modello sceglie, con quello che serve per giudicare. */
export async function candidatePer(riga: RigaDaAgganciare, codiciVettore: Map<string, string>): Promise<Candidata[]> {
  if (!riga.data) return [];
  const db = createAdminClient().schema("vettori");
  let q = db
    .from("spedizioni")
    .select("id, direzione, numero_riferimento, numero_riferimento_norm, numero_protocollo, data_documento, controparte_nome, zona_provincia, colli_bolla, peso_bolla, vettore_id, origine")
    .gte("data_documento", giorni(riga.data, -GIORNI_FINESTRA))
    .lte("data_documento", giorni(riga.data, GIORNI_FINESTRA))
    .neq("stato", "ignorata")
    .limit(2000);
  if (riga.direzione) q = q.eq("direzione", riga.direzione);
  const { data, error } = await q;
  if (error) throw new Error(`Lettura bolle fallita: ${error.message}`);

  const norm = normalizzaRiferimento(riga.riferimento);
  const valutate = ((data ?? []) as Array<Record<string, unknown>>).map((s) => {
    const indizi: string[] = [];
    const sNorm = s.numero_riferimento_norm as string | null;
    if (norm && sNorm === norm) indizi.push("stesso numero");
    else if (numeroSomigliante(riga.riferimento, s.numero_riferimento as string | null)) indizi.push("numero simile");
    else if (numeroSomigliante(riga.riferimento, s.numero_protocollo as string | null)) indizi.push("numero = nostro protocollo");
    if (nomiCompatibili(riga.controparte, s.controparte_nome as string | null)) indizi.push("nome compatibile");
    return { s, indizi, giorni: distanza(riga.data!, String(s.data_documento)) };
  }).filter((v) => v.indizi.length > 0);

  const punteggio = (v: (typeof valutate)[number]) =>
    (v.indizi.includes("stesso numero") ? 100 : 0) +
    (v.indizi.includes("numero simile") || v.indizi.includes("numero = nostro protocollo") ? 60 : 0) +
    (v.indizi.includes("nome compatibile") ? 40 : 0) -
    v.giorni * 2;
  const scelte = valutate.sort((a, b) => punteggio(b) - punteggio(a)).slice(0, MASSIMO_CANDIDATI);
  if (scelte.length === 0) return [];

  const idSpedizioni = scelte.map((v) => String(v.s.id));
  const [{ data: legami }, { data: gia }] = await Promise.all([
    db.from("spedizioni_documenti").select("spedizione_id, id_documento, codice_profilo").in("spedizione_id", idSpedizioni),
    db.from("controlli").select("spedizione_id").in("spedizione_id", idSpedizioni),
  ]);
  const documenti = ((legami ?? []) as Array<{ spedizione_id: string; id_documento: number; codice_profilo: string | null }>);
  const luoghi = new Map<number, { localita: string | null; provincia: string | null }>();
  if (documenti.length) {
    const { data: docs } = await createAdminClient()
      .schema("bi")
      .from("trasporti_documenti")
      .select("id_documento, soggetto_localita, soggetto_provincia, dest_localita, dest_provincia")
      .in("id_documento", documenti.map((d) => d.id_documento));
    for (const d of (docs ?? []) as Array<Record<string, unknown>>) {
      luoghi.set(Number(d.id_documento), {
        localita: ((d.dest_localita as string | null) || (d.soggetto_localita as string | null)) ?? null,
        provincia: ((d.dest_provincia as string | null) || (d.soggetto_provincia as string | null)) ?? null,
      });
    }
  }
  const agganciate = new Map<string, number>();
  for (const g of (gia ?? []) as Array<{ spedizione_id: string }>) agganciate.set(g.spedizione_id, (agganciate.get(g.spedizione_id) ?? 0) + 1);

  return scelte.map((v, i) => {
    const id = String(v.s.id);
    const doc = documenti.find((d) => d.spedizione_id === id);
    const luogo = doc ? luoghi.get(doc.id_documento) : undefined;
    return {
      etichetta: `C${i + 1}`,
      spedizioneId: id,
      numero: (v.s.numero_riferimento as string | null) ?? null,
      protocollo: (v.s.numero_protocollo as string | null) ?? null,
      data: String(v.s.data_documento),
      controparte: (v.s.controparte_nome as string | null) ?? null,
      localita: luogo?.localita ?? null,
      provincia: (luogo?.provincia ?? (v.s.zona_provincia as string | null))?.trim() || null,
      colli: num(v.s.colli_bolla),
      peso: num(v.s.peso_bolla),
      vettore: v.s.vettore_id ? codiciVettore.get(String(v.s.vettore_id)) ?? null : null,
      profilo: doc?.codice_profilo ?? null,
      origine: String(v.s.origine),
      giaAgganciataA: agganciate.get(id) ?? 0,
      indizi: v.indizi,
    };
  });
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scelta", "sicurezza", "motivo"],
  properties: {
    scelta: { type: ["string", "null"], description: "Etichetta della bolla scelta (C1, C2...) oppure null se nessuna e' la spedizione giusta." },
    sicurezza: { type: "string", enum: ["alta", "media", "bassa"] },
    motivo: { type: "string", description: "Una o due frasi in italiano, con gli elementi concreti che hanno deciso." },
  },
};

function istruzioni(riga: RigaDaAgganciare, candidate: Candidata[]): string {
  const fmt = (v: unknown) => (v == null || v === "" ? "-" : String(v));
  const elenco = candidate.map((c) =>
    `${c.etichetta}: numero ${fmt(c.numero)}${c.protocollo ? ` (nostro protocollo ${c.protocollo})` : ""}, data ${c.data}, ` +
    `cliente/fornitore «${fmt(c.controparte)}», sede ${fmt(c.localita)} (${fmt(c.provincia)}), colli ${fmt(c.colli)}, peso ${fmt(c.peso)} kg, ` +
    `vettore in gestionale ${fmt(c.vettore)}, profilo ${fmt(c.profilo)}, origine ${c.origine}` +
    `${c.giaAgganciataA ? `, GIA' agganciata a ${c.giaAgganciataA} altra/e riga/e di fattura` : ""}; indizi: ${c.indizi.join(", ")}.`
  ).join("\n");

  return `Sei l'addetta amministrativa di un'azienda italiana che controlla le fatture dei corrieri.
Devi dire a quale bolla (documento di trasporto del nostro gestionale) corrisponde una riga della fattura del corriere.

Come si legge una riga di fattura:
- sulle PARTENZE (uscita) il numero e' il nostro numero di bolla (BC); sugli ARRIVI (entrata) e' il numero del DDT del fornitore, che il fornitore puo' scrivere con prefissi o suffissi suoi (anno davanti, lettere in coda: «694DTV» = 694, «260020147» = 20147).
- il nome in fattura e' spesso il PUNTO DI CONSEGNA o di ritiro, non la ragione sociale: puo' essere un magazzino, una sede, un logistico o l'utilizzatore finale del cliente, ed e' abbreviato e troncato («NCR BIOCHEMIC» = «N.C.R. BIOCHEMICAL»).
- il peso in fattura puo' essere arrotondato o portato al minimo tassabile del corriere (Trading Post fattura almeno 3 kg; i corrieri arrotondano al kg); colli e peso uguali o vicini sono un indizio forte.
- la data della fattura e' quella del ritiro: di solito coincide con la bolla o la segue di 1-3 giorni.

Regole:
- scegli SOLO fra le candidate elencate, indicando l'etichetta (C1, C2...). Se nessuna e' convincente rispondi scelta null.
- una bolla «GIA' agganciata» a un'altra riga di fattura puo' comunque essere giusta (un DDT puo' essere fatturato in due righe), ma e' un indizio contro: dillo nel motivo.
- sicurezza «alta» solo se numero (anche con prefisso/suffisso) e data tornano e almeno uno fra peso e nome conferma, e nessun'altra candidata e' plausibile.
- sicurezza «media» se la scelta e' la piu' plausibile ma un elemento non torna; «bassa» se e' un'ipotesi.
- nel motivo cita gli elementi concreti (numero, data, peso, nome); niente frasi generiche.

RIGA DI FATTURA (${riga.vettore}, fattura ${riga.fattura}, riga ${riga.rigaNumero}):
verso ${fmt(riga.direzione)}, data ${fmt(riga.data)}, numero citato ${fmt(riga.riferimento)}, nome in fattura «${fmt(riga.controparte)}», provincia ${fmt(riga.provincia)}, colli ${fmt(riga.colli)}, peso ${fmt(riga.peso)} kg${riga.pesoTassato ? ` (tassato ${riga.pesoTassato} kg)` : ""}, importo ${fmt(riga.totale)} euro.

BOLLE CANDIDATE:
${elenco}`;
}

/** Chiede al modello. Non scrive niente: restituisce la proposta. */
export async function proponiAggancio(
  riga: RigaDaAgganciare,
  candidate: Candidata[],
  modello: string = MODELLO_AGGANCIO_PREDEFINITO
): Promise<PropostaAggancio> {
  if (candidate.length === 0) {
    return { esito: "senza_candidati", spedizioneId: null, sicurezza: null, motivo: "Nessuna bolla con numero, nome o data compatibili entro 10 giorni.", candidati: [], modello: null, tokenIngresso: null, tokenUscita: null, costo: null };
  }
  try {
    const risposta = await chiediVisione({ modello, istruzioni: istruzioni(riga, candidate), immagini: [], schema: SCHEMA, massimoToken: 2000, timeoutMs: 90_000 });
    const r = risposta.contenuto as { scelta: string | null; sicurezza: "alta" | "media" | "bassa"; motivo: string };
    const etichetta = r.scelta?.trim().toUpperCase() ?? null;
    const scelta = etichetta ? candidate.find((c) => c.etichetta === etichetta) : undefined;
    if (r.scelta && !scelta) {
      return { esito: "errore", spedizioneId: null, sicurezza: null, motivo: `Il modello ha indicato «${r.scelta}», che non e' fra le candidate.`, candidati: candidate, modello, tokenIngresso: risposta.tokenIngresso, tokenUscita: risposta.tokenUscita, costo: risposta.costo };
    }
    return {
      esito: scelta ? "scelta" : "nessuna",
      spedizioneId: scelta?.spedizioneId ?? null,
      sicurezza: r.sicurezza,
      motivo: r.motivo,
      candidati: candidate,
      modello,
      tokenIngresso: risposta.tokenIngresso,
      tokenUscita: risposta.tokenUscita,
      costo: risposta.costo,
    };
  } catch (e) {
    return { esito: "errore", spedizioneId: null, sicurezza: null, motivo: e instanceof Error ? e.message : String(e), candidati: candidate, modello, tokenIngresso: null, tokenUscita: null, costo: null };
  }
}

/** Salva la proposta come «viva», scartando quella precedente della stessa riga. */
export async function salvaProposta(rigaId: string, p: PropostaAggancio): Promise<void> {
  const db = createAdminClient().schema("vettori");
  const { error: sErr } = await db.from("agganci_proposti").update({ stato: "scartata", decisa_il: new Date().toISOString() }).eq("fattura_riga_id", rigaId).eq("stato", "proposta");
  if (sErr) throw new Error(`Scarto proposta precedente fallito: ${sErr.message}`);
  const { error } = await db.from("agganci_proposti").insert({
    fattura_riga_id: rigaId,
    spedizione_id: p.spedizioneId,
    esito: p.esito,
    sicurezza: p.sicurezza,
    motivo: p.motivo,
    candidati: p.candidati,
    modello: p.modello,
    token_ingresso: p.tokenIngresso,
    token_uscita: p.tokenUscita,
    costo_usd: p.costo,
  });
  if (error) throw new Error(`Salvataggio proposta fallito: ${error.message}`);
}

/** Le righe che hanno gia' una proposta viva: non si ripagano. */
export async function righeConProposta(): Promise<Set<string>> {
  const { data, error } = await createAdminClient().schema("vettori").from("agganci_proposti").select("fattura_riga_id").eq("stato", "proposta");
  if (error) throw new Error(`Lettura proposte fallita: ${error.message}`);
  return new Set(((data ?? []) as Array<{ fattura_riga_id: string }>).map((r) => r.fattura_riga_id));
}
