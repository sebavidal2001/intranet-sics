import { createAdminClient } from "@/lib/supabase/admin";
import { normNumero } from "./controllo";
import { azioniConsentite, oggiRoma } from "./stati";
import type {
  AggiornaCampagnaInput,
  AggiornaInvioInput,
  AssegnaInvioInput,
  CreaCampagnaInput,
  CreaPubblicoInput,
  DestinatariInput,
  FiltroClientiCampagneInput,
  PubblicoInput,
} from "./schemi";
import type {
  Campagna,
  CampagnaRiepilogo,
  CategoriaClienti,
  Cliente,
  ClienteConCampagne,
  ClientePubblicoRiga,
  ClienteSelezione,
  DashboardCampagne,
  ElencoClientiCampagne,
  ElencoInvii,
  Invio,
  Pubblico,
  PubblicoResponse,
  PubblicoRiepilogo,
  SchedaCliente,
} from "./tipi";

/**
 * Accesso ai dati del Portale Campagne (schema `campagne`, migration 131).
 *
 * Solo lato server, con il service role: `authenticated` non ha GRANT sullo
 * schema. Quindi QUI non c'e' nessuna autorizzazione: la fanno le route e le
 * pagine con `requireCampagne` / `getCampagneContext` prima di chiamare.
 */

export const db = () => createAdminClient().schema("campagne");

/** Errore della logica di dominio, con lo stato HTTP da restituire. */
export class ErroreCampagne extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ErroreCampagne";
  }
}

interface ErroreDb {
  message: string;
  code?: string;
}

/**
 * Traduce gli errori del database in messaggi che un operatore capisce. I vincoli
 * unici sono la difesa vera contro i doppioni: due persone che assegnano la
 * stessa campagna nello stesso istante passano entrambe i controlli applicativi,
 * e ne passa una sola l'indice.
 */
function traduci(contesto: string, e: ErroreDb): Error {
  if (e.code === "23505") {
    if (e.message.includes("invii_ordine_uq")) {
      return new ErroreCampagne(409, "Su questo ordine c'è già una campagna: ogni ordine ne porta una sola.");
    }
    if (e.message.includes("invii_campagna_cliente_uq")) {
      return new ErroreCampagne(409, "Questo cliente ha già questa campagna.");
    }
    if (e.message.includes("campagne_codice_key")) {
      return new ErroreCampagne(409, "Esiste già una campagna con questo codice.");
    }
    if (e.message.includes("pubblici_nome_uq")) {
      return new ErroreCampagne(409, "Esiste già un pubblico con questo nome.");
    }
    return new ErroreCampagne(409, "Il dato esiste già.");
  }
  if (e.code === "23503" && e.message.includes("pubblico_id")) {
    return new ErroreCampagne(400, "Il pubblico scelto non esiste.");
  }
  if (e.code === "PT409") return new ErroreCampagne(409, e.message);
  if (e.code === "23514" && e.message.includes("invii_referente_ordine_obbligatori")) {
    return new ErroreCampagne(400, "Referente e numero d'ordine sono obbligatori.");
  }
  return new Error(`${contesto}: ${e.message}`);
}

export function ok<T>(contesto: string, r: { data: T | null; error: ErroreDb | null }): T | null {
  if (r.error) throw traduci(contesto, r.error);
  return r.data;
}

type Pagina<T> = PromiseLike<{ data: T[] | null; error: ErroreDb | null }>;

/** PostgREST tronca le risposte (1.000 righe sul Supabase gestito): si legge a pagine. */
export async function tuttePagine<T>(contesto: string, pagina: (da: number, a: number) => Pagina<T>): Promise<T[]> {
  const DIM = 1000;
  const tutte: T[] = [];
  for (let da = 0; ; da += DIM) {
    const righe = ok(contesto, await pagina(da, da + DIM - 1)) ?? [];
    tutte.push(...righe);
    if (righe.length < DIM) return tutte;
  }
}

export const aBlocchi = <T,>(v: T[], dim: number): T[][] =>
  Array.from({ length: Math.ceil(v.length / dim) }, (_, i) => v.slice(i * dim, (i + 1) * dim));

const COLONNE_CLIENTE = "codice_cliente, ragione_sociale, agente_nome, cat_commerciale, cat_attivita, rivenditore";
const COLONNE_INVIO = "*, campagna:campagne(codice, nome)";
const COLONNE_CAMPAGNA = "*, pubblico:pubblici(nome, standard)";

/**
 * Nome e cognome (intranet) di chi ha assegnato la campagna o segnato la consegna.
 * Gli invii portano solo gli id degli utenti: si risolvono qui, in una lettura sola,
 * invece di lasciare alla schermata un id che non dice niente. Lo storico importato
 * dall'Excel non ha utente: resta `null`.
 */
async function nomiUtenti(ids: string[]): Promise<Map<string, string>> {
  const nomi = new Map<string, string>();
  for (const blocco of aBlocchi([...new Set(ids)], 100)) {
    const r = await createAdminClient().from("utenti").select("id, nome, cognome").in("id", blocco);
    for (const u of (ok("nomi utenti", r) ?? []) as { id: string; nome: string; cognome: string }[]) {
      nomi.set(u.id, `${u.nome} ${u.cognome}`.trim());
    }
  }
  return nomi;
}

type InvioGrezzo = Omit<Invio, "assegnata_da_nome" | "consegna_registrata_da_nome"> & {
  assegnata_da?: string | null;
  consegna_registrata_da?: string | null;
};

async function conNomi(invii: InvioGrezzo[]): Promise<Invio[]> {
  const ids = invii.flatMap((i) => [i.assegnata_da, i.consegna_registrata_da]).filter((x): x is string => !!x);
  const nomi = ids.length > 0 ? await nomiUtenti(ids) : new Map<string, string>();
  return invii.map(({ assegnata_da, consegna_registrata_da, ...resto }) => ({
    ...resto,
    assegnata_da_nome: assegnata_da ? (nomi.get(assegnata_da) ?? null) : null,
    consegna_registrata_da_nome: consegna_registrata_da ? (nomi.get(consegna_registrata_da) ?? null) : null,
  }));
}

/** Toglie dalla ricerca i caratteri che spezzerebbero la sintassi dei filtri PostgREST. */
export function pulisciRicerca(q: string): string {
  return q.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

// ─── Clienti ───────────────────────────────────────────────────────────────
export async function cercaClienti(q: string): Promise<Cliente[]> {
  const t = pulisciRicerca(q);
  if (t.length < 2) return [];
  const r = await db()
    .from("v_clienti")
    .select(COLONNE_CLIENTE)
    .or(`codice_cliente.ilike.%${t}%,ragione_sociale.ilike.%${t}%`)
    .order("ragione_sociale")
    .limit(30);
  return (ok("ricerca clienti", r) ?? []) as Cliente[];
}

async function leggiCliente(codice: string): Promise<Cliente> {
  const r = await db().from("v_clienti").select(COLONNE_CLIENTE).eq("codice_cliente", codice.trim()).maybeSingle();
  const c = ok("lettura cliente", r) as Cliente | null;
  if (!c) throw new ErroreCampagne(404, "Cliente non trovato.");
  return c;
}

export async function schedaCliente(codice: string): Promise<Omit<SchedaCliente, "ordini_aperti" | "anomalie">> {
  const cliente = await leggiCliente(codice);
  const [invii, assegnabili] = await Promise.all([
    db().from("invii").select(COLONNE_INVIO).eq("codice_cliente", cliente.codice_cliente).order("assegnata_il", { ascending: false }),
    db().rpc("campagne_assegnabili", { p_codice_cliente: cliente.codice_cliente }),
  ]);
  return {
    cliente,
    invii: await conNomi((ok("invii del cliente", invii) ?? []) as unknown as InvioGrezzo[]),
    assegnabili: (ok("campagne assegnabili", assegnabili) ?? []) as Campagna[],
  };
}

// ─── Invii ─────────────────────────────────────────────────────────────────
async function leggiInvio(id: string): Promise<Invio> {
  const r = await db().from("invii").select(COLONNE_INVIO).eq("id", id).maybeSingle();
  const i = ok("lettura invio", r) as unknown as InvioGrezzo | null;
  if (!i) throw new ErroreCampagne(404, "Invio non trovato.");
  return (await conNomi([i]))[0];
}

async function spiegaCampagnaNonAssegnabile(codiceCliente: string, campagnaId: string): Promise<ErroreCampagne> {
  const { data: c } = await db().from("campagne").select("codice, stato").eq("id", campagnaId).maybeSingle();
  if (!c) return new ErroreCampagne(404, "Campagna non trovata.");
  if (c.stato !== "attiva") return new ErroreCampagne(409, `La campagna ${c.codice} è ${c.stato}: non si può assegnare.`);
  const { data: d } = await db()
    .from("destinatari")
    .select("codice_cliente")
    .eq("campagna_id", campagnaId)
    .eq("codice_cliente", codiceCliente)
    .maybeSingle();
  if (!d) return new ErroreCampagne(409, `Il cliente non è tra i destinatari della campagna ${c.codice}.`);
  return new ErroreCampagne(409, `Il cliente ha già ricevuto la campagna ${c.codice}.`);
}

/**
 * Assegna una campagna a un cliente: busta preparata (referente e ordine) oppure
 * consegna diretta al banco. La campagna deve essere fra le assegnabili del
 * cliente — attiva, di cui è destinatario, non ancora ricevuta — e si controlla
 * qui, non nella schermata: il client può essere vecchio o manomesso.
 */
export async function creaInvio(input: AssegnaInvioInput, userId: string): Promise<Invio> {
  const cliente = await leggiCliente(input.codice_cliente);
  const assegnabili = (ok("campagne assegnabili", await db().rpc("campagne_assegnabili", { p_codice_cliente: cliente.codice_cliente })) ??
    []) as Campagna[];
  if (!assegnabili.some((c) => c.id === input.campagna_id)) {
    throw await spiegaCampagnaNonAssegnabile(cliente.codice_cliente, input.campagna_id);
  }

  const base = {
    campagna_id: input.campagna_id,
    codice_cliente: cliente.codice_cliente,
    ragione_sociale: cliente.ragione_sociale,
    assegnata_da: userId,
    note: input.note?.trim() || null,
  };
  const riga =
    input.tipo === "ordine"
      ? {
          ...base,
          stato: "preparata",
          referente: input.referente,
          ordine_numero: normNumero(input.ordine_numero),
          ordine_anno: input.ordine_anno,
        }
      : {
          ...base,
          stato: "consegnata_banco",
          referente: input.referente?.trim() || null,
          data_consegna: input.data_consegna ?? oggiRoma(),
          fonte_consegna: "banco",
          consegna_registrata_da: userId,
        };

  const r = await db().from("invii").insert(riga).select(COLONNE_INVIO).single();
  return (await conNomi([ok("creazione invio", r) as unknown as InvioGrezzo]))[0];
}

/** Cambia un invio. Le azioni ammesse dipendono dallo stato (`azioniConsentite`). */
export async function aggiornaInvio(id: string, input: AggiornaInvioInput, userId: string): Promise<Invio> {
  const invio = await leggiInvio(id);
  if (!azioniConsentite(invio).includes(input.azione)) {
    throw new ErroreCampagne(409, "Questa operazione non è consentita nello stato attuale dell'invio.");
  }

  let patch: Record<string, unknown>;
  switch (input.azione) {
    case "modifica": {
      patch = {};
      if (input.referente !== undefined) patch.referente = input.referente;
      if (input.ordine_numero !== undefined) patch.ordine_numero = normNumero(input.ordine_numero);
      if (input.ordine_anno !== undefined) patch.ordine_anno = input.ordine_anno;
      if (input.note !== undefined) patch.note = input.note?.trim() || null;
      if (Object.keys(patch).length === 0) throw new ErroreCampagne(400, "Nessuna modifica.");
      break;
    }
    case "consegna": {
      if (input.data_consegna > oggiRoma()) throw new ErroreCampagne(400, "La data di consegna non può essere futura.");
      patch = {
        stato: "consegnata",
        data_consegna: input.data_consegna,
        fonte_consegna: "manuale",
        consegna_registrata_da: userId,
      };
      break;
    }
    case "banco": {
      const data = input.data_consegna ?? oggiRoma();
      if (data > oggiRoma()) throw new ErroreCampagne(400, "La data di consegna non può essere futura.");
      patch = {
        stato: "consegnata_banco",
        data_consegna: data,
        fonte_consegna: "banco",
        consegna_registrata_da: userId,
      };
      break;
    }
    case "annulla":
      patch = {
        stato: "annullata",
        annullata_il: new Date().toISOString(),
        annullata_da: userId,
        motivo_annullo: input.motivo,
      };
      break;
  }

  // Condizionato allo stato letto: se nel frattempo l'ha cambiato un collega,
  // non si sovrascrive in silenzio.
  const r = await db().from("invii").update(patch).eq("id", id).eq("stato", invio.stato).select(COLONNE_INVIO);
  const righe = await conNomi((ok("aggiornamento invio", r) ?? []) as unknown as InvioGrezzo[]);
  if (righe.length === 0) throw new ErroreCampagne(409, "L'invio è stato modificato da qualcun altro: ricarica la pagina.");
  return righe[0];
}

export interface FiltroElencoInvii {
  stato?: Invio["stato"];
  campagna_id?: string[];
  /** Chi ha seguito la campagna: l'utente che ha assegnato l'invio. */
  utente_id?: string;
  q?: string;
  limit: number;
  offset: number;
}

export async function elencoInvii(f: FiltroElencoInvii): Promise<ElencoInvii> {
  let query = db().from("invii").select(COLONNE_INVIO, { count: "exact" });
  query = f.stato ? query.eq("stato", f.stato) : query.neq("stato", "annullata");
  if (f.campagna_id && f.campagna_id.length > 0) query = query.in("campagna_id", f.campagna_id);
  if (f.utente_id) query = query.eq("assegnata_da", f.utente_id);
  const t = f.q ? pulisciRicerca(f.q) : "";
  if (t.length >= 2) query = query.or(`codice_cliente.ilike.%${t}%,ragione_sociale.ilike.%${t}%`);
  const r = await query.order("assegnata_il", { ascending: false }).range(f.offset, f.offset + f.limit - 1);
  if (r.error) throw traduci("elenco invii", r.error);
  return { invii: await conNomi((r.data ?? []) as unknown as InvioGrezzo[]), totale: r.count ?? 0 };
}

export async function dashboard(): Promise<Pick<DashboardCampagne, "preparate" | "da_spedire" | "consegnate_30_giorni">> {
  const conta = async (stato: string) => {
    const r = await db().from("invii").select("id", { count: "exact", head: true }).eq("stato", stato);
    if (r.error) throw traduci("conteggio invii", r.error);
    return r.count ?? 0;
  };
  const da30 = oggiRoma(new Date(Date.now() - 30 * 86_400_000));
  const [preparate, daSpedire, consegnate] = await Promise.all([
    conta("preparata"),
    conta("da_spedire"),
    db()
      .from("invii")
      .select("id", { count: "exact", head: true })
      .in("stato", ["consegnata", "consegnata_banco"])
      .gte("data_consegna", da30),
  ]);
  if (consegnate.error) throw traduci("conteggio consegne", consegnate.error);
  return { preparate, da_spedire: daSpedire, consegnate_30_giorni: consegnate.count ?? 0 };
}

/** Le buste ancora in lavorazione, dalle più recenti: la lista sotto i contatori. */
export async function inviiAperti(limit = 10): Promise<ElencoInvii["invii"]> {
  const r = await db()
    .from("invii")
    .select(COLONNE_INVIO)
    .in("stato", ["preparata", "da_spedire"])
    .order("assegnata_il", { ascending: false })
    .limit(limit);
  return conNomi((ok("buste aperte", r) ?? []) as unknown as InvioGrezzo[]);
}

// ─── Campagne ──────────────────────────────────────────────────────────────
interface RigaRiepilogo {
  id: string;
  destinatari: number;
  preparate: number;
  da_spedire: number;
  consegnate: number;
  consegnate_banco: number;
}

const unisci = (c: Campagna, r?: RigaRiepilogo): CampagnaRiepilogo => ({
  ...c,
  destinatari: r?.destinatari ?? 0,
  preparate: r?.preparate ?? 0,
  da_spedire: r?.da_spedire ?? 0,
  consegnate: r?.consegnate ?? 0,
  consegnate_banco: r?.consegnate_banco ?? 0,
});

export async function elencoCampagne(): Promise<CampagnaRiepilogo[]> {
  const [c, r] = await Promise.all([
    db().from("campagne").select(COLONNE_CAMPAGNA).order("ordine"),
    db().from("v_campagne_riepilogo").select("*"),
  ]);
  const per = new Map(((ok("riepilogo campagne", r) ?? []) as RigaRiepilogo[]).map((x) => [x.id, x]));
  return ((ok("elenco campagne", c) ?? []) as Campagna[]).map((x) => unisci(x, per.get(x.id)));
}

export async function leggiCampagna(id: string): Promise<CampagnaRiepilogo> {
  const [c, r] = await Promise.all([
    db().from("campagne").select(COLONNE_CAMPAGNA).eq("id", id).maybeSingle(),
    db().from("v_campagne_riepilogo").select("*").eq("id", id).maybeSingle(),
  ]);
  const campagna = ok("lettura campagna", c) as Campagna | null;
  if (!campagna) throw new ErroreCampagne(404, "Campagna non trovata.");
  return unisci(campagna, (ok("riepilogo campagna", r) ?? undefined) as RigaRiepilogo | undefined);
}

export async function creaCampagna(input: CreaCampagnaInput, userId: string): Promise<CampagnaRiepilogo> {
  const r = await db()
    .from("campagne")
    .insert({
      codice: input.codice,
      nome: input.nome,
      note: input.note?.trim() || null,
      articolo_codice: input.articolo_codice,
      testo_riconoscimento: input.testo_riconoscimento,
      marchio: input.marchio?.trim() || null,
      articoli_promossi: input.articoli_promossi,
      stato: input.stato,
      // Assente = il database mette lo standard.
      ...(input.pubblico_id ? { pubblico_id: input.pubblico_id } : {}),
      created_by: userId,
      stato_cambiato_da: userId,
    })
    .select("id")
    .single();
  const campagna = ok("creazione campagna", r) as { id: string };
  if (input.applica_pubblico) {
    ok("pubblico della campagna", await db().rpc("applica_pubblico", { p_campagna: campagna.id, p_pubblico: null, p_utente: userId }));
  }
  return leggiCampagna(campagna.id);
}

export async function aggiornaCampagna(id: string, input: AggiornaCampagnaInput, userId: string): Promise<CampagnaRiepilogo> {
  const attuale = await leggiCampagna(id);

  // L'articolo e' cio' che il controllo cerca nell'ordine: cambiarlo con invii gia'
  // fatti li renderebbe incoerenti con la riga che l'operatrice ha inserito.
  if (input.articolo_codice !== undefined && input.articolo_codice !== attuale.articolo_codice) {
    const { count } = await db()
      .from("invii")
      .select("id", { count: "exact", head: true })
      .eq("campagna_id", id)
      .neq("stato", "annullata");
    if ((count ?? 0) > 0) {
      throw new ErroreCampagne(409, "L'articolo non si può cambiare: la campagna ha già degli invii.");
    }
  }

  const patch: Record<string, unknown> = { ...input };
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (input.marchio !== undefined) patch.marchio = input.marchio?.trim() || null;
  if (input.stato !== undefined && input.stato !== attuale.stato) patch.stato_cambiato_da = userId;

  ok("aggiornamento campagna", await db().from("campagne").update(patch).eq("id", id).select("id").single());
  return leggiCampagna(id);
}

// ─── Destinatari ───────────────────────────────────────────────────────────
export interface EsitoDestinatari {
  aggiunti: number;
  rimossi: number;
  /** Codici non presenti fra i clienti o esclusi perché rivenditori. */
  non_validi: number;
  /** Clienti che hanno già un invio: restano destinatari, lo storico non si cancella. */
  con_invio: number;
}

const esitoVuoto = (): EsitoDestinatari => ({ aggiunti: 0, rimossi: 0, non_validi: 0, con_invio: 0 });

async function inserisciDestinatari(campagnaId: string, codici: string[], userId: string): Promise<number> {
  let aggiunti = 0;
  for (const blocco of aBlocchi(codici, 500)) {
    const r = await db()
      .from("destinatari")
      .upsert(
        blocco.map((codice_cliente) => ({ campagna_id: campagnaId, codice_cliente, aggiunto_da: userId })),
        { onConflict: "campagna_id,codice_cliente", ignoreDuplicates: true }
      )
      .select("codice_cliente");
    aggiunti += (ok("inserimento destinatari", r) ?? []).length;
  }
  return aggiunti;
}

async function codiciConInvio(campagnaId: string, codici: string[]): Promise<Set<string>> {
  const con = new Set<string>();
  for (const blocco of aBlocchi(codici, 100)) {
    const r = await db()
      .from("invii")
      .select("codice_cliente")
      .eq("campagna_id", campagnaId)
      .neq("stato", "annullata")
      .in("codice_cliente", blocco);
    for (const x of (ok("invii della campagna", r) ?? []) as { codice_cliente: string }[]) con.add(x.codice_cliente);
  }
  return con;
}

async function togliDestinatari(campagnaId: string, codici: string[]): Promise<{ rimossi: number; conInvio: number }> {
  const con = await codiciConInvio(campagnaId, codici);
  const daTogliere = codici.filter((c) => !con.has(c));
  let rimossi = 0;
  for (const blocco of aBlocchi(daTogliere, 100)) {
    const r = await db().from("destinatari").delete().eq("campagna_id", campagnaId).in("codice_cliente", blocco).select("codice_cliente");
    rimossi += (ok("rimozione destinatari", r) ?? []).length;
  }
  return { rimossi, conInvio: con.size };
}

/** Quali fra i codici sono clienti esistenti e non rivenditori. */
async function codiciValidi(codici: string[]): Promise<Set<string>> {
  const validi = new Set<string>();
  for (const blocco of aBlocchi(codici, 100)) {
    const r = await db().from("v_clienti").select("codice_cliente").eq("rivenditore", false).in("codice_cliente", blocco);
    for (const x of (ok("verifica clienti", r) ?? []) as { codice_cliente: string }[]) validi.add(x.codice_cliente);
  }
  return validi;
}

export async function categorieClienti(campagnaId: string): Promise<CategoriaClienti[]> {
  return tuttePagine<CategoriaClienti>("categorie clienti", (da, a) =>
    db().rpc("categorie_clienti", { p_campagna_id: campagnaId }).range(da, a)
  );
}

export async function clientiCategoria(campagnaId: string, categoria: string): Promise<ClienteSelezione[]> {
  return tuttePagine<ClienteSelezione>("clienti della categoria", (da, a) =>
    db().rpc("clienti_categoria", { p_campagna_id: campagnaId, p_categoria: categoria }).range(da, a)
  );
}

export async function modificaDestinatari(
  campagnaId: string,
  input: DestinatariInput,
  userId: string
): Promise<{ esito: EsitoDestinatari; campagna: CampagnaRiepilogo }> {
  const campagna = await leggiCampagna(campagnaId);
  if (campagna.stato === "terminata") {
    throw new ErroreCampagne(409, "Una campagna terminata non si può più modificare.");
  }
  const esito = esitoVuoto();

  switch (input.azione) {
    case "applica_pubblico": {
      const r = await db().rpc("applica_pubblico", { p_campagna: campagnaId, p_pubblico: null, p_utente: userId });
      esito.aggiunti = Number(ok("pubblico della campagna", r) ?? 0);
      break;
    }
    case "aggiungi": {
      const codici = [...new Set(input.codici)];
      const validi = await codiciValidi(codici);
      esito.non_validi = codici.length - validi.size;
      esito.aggiunti = await inserisciDestinatari(campagnaId, [...validi], userId);
      break;
    }
    case "rimuovi": {
      const t = await togliDestinatari(campagnaId, [...new Set(input.codici)]);
      esito.rimossi = t.rimossi;
      esito.con_invio = t.conInvio;
      break;
    }
    case "aggiungi_categorie": {
      for (const categoria of input.categorie) {
        const clienti = await clientiCategoria(campagnaId, categoria);
        esito.aggiunti += await inserisciDestinatari(
          campagnaId,
          clienti.filter((c) => !c.selezionato).map((c) => c.codice_cliente),
          userId
        );
      }
      break;
    }
    case "rimuovi_categorie": {
      for (const categoria of input.categorie) {
        const clienti = await clientiCategoria(campagnaId, categoria);
        const t = await togliDestinatari(
          campagnaId,
          clienti.filter((c) => c.selezionato).map((c) => c.codice_cliente)
        );
        esito.rimossi += t.rimossi;
        esito.con_invio += t.conInvio;
      }
      break;
    }
  }
  return { esito, campagna: await leggiCampagna(campagnaId) };
}

// ─── Pubblici ──────────────────────────────────────────────────────────────
const COLONNE_PUBBLICO = "id, nome, descrizione, standard, agenti, categorie_commerciali, categorie_attivita, clienti_extra, aggiornato_il";

/** Tutti i pubblici, lo standard per primo, con a quanti clienti arrivano e quante campagne li usano. */
export async function elencoPubblici(): Promise<PubblicoRiepilogo[]> {
  const [p, r] = await Promise.all([
    db().from("pubblici").select(COLONNE_PUBBLICO).order("standard", { ascending: false }).order("nome"),
    db().rpc("pubblici_riepilogo"),
  ]);
  const per = new Map(((ok("riepilogo pubblici", r) ?? []) as { id: string; raggiunti: number; campagne: number }[]).map((x) => [x.id, x]));
  return ((ok("elenco pubblici", p) ?? []) as Pubblico[]).map((x) => ({
    ...x,
    raggiunti: Number(per.get(x.id)?.raggiunti ?? 0),
    campagne: Number(per.get(x.id)?.campagne ?? 0),
  }));
}

/** Per i menu a tendina: solo id, nome e se e' lo standard. */
export async function pubbliciPerScelta(): Promise<{ id: string; nome: string; standard: boolean }[]> {
  const r = await db().from("pubblici").select("id, nome, standard").order("standard", { ascending: false }).order("nome");
  return (ok("pubblici", r) ?? []) as { id: string; nome: string; standard: boolean }[];
}

/** Quanti clienti rientrano nel pubblico della campagna e non ne sono ancora destinatari. */
export async function pubblicoMancanti(campagnaId: string): Promise<number> {
  return Number(ok("clienti mancanti", await db().rpc("pubblico_mancanti", { p_campagna: campagnaId })) ?? 0);
}

async function leggiConfigPubblico(id: string): Promise<Pubblico> {
  const r = await db().from("pubblici").select(COLONNE_PUBBLICO).eq("id", id).maybeSingle();
  const p = ok("lettura pubblico", r) as Pubblico | null;
  if (!p) throw new ErroreCampagne(404, "Pubblico non trovato.");
  return p;
}

export async function leggiPubblico(id: string): Promise<PubblicoResponse> {
  const [config, conteggio, usato, clienti] = await Promise.all([
    leggiConfigPubblico(id),
    db().rpc("pubblico_conteggio", { p_pubblico: id }),
    db().from("campagne").select("id, codice, nome, stato").eq("pubblico_id", id).order("ordine"),
    // Tutti i clienti non rivenditori (circa 3.800): la pagina ci calcola il conteggio
    // in tempo reale mentre si sceglie, senza un'andata e ritorno a ogni clic.
    tuttePagine<ClientePubblicoRiga>("clienti del pubblico", (da, a) =>
      db()
        .from("v_clienti")
        .select("codice_cliente, ragione_sociale, agente_nome, cat_commerciale, cat_attivita")
        .eq("rivenditore", false)
        .order("codice_cliente")
        .range(da, a)
    ),
  ]);
  return {
    config,
    raggiunti: Number(ok("conteggio pubblico", conteggio) ?? 0),
    campagne: (ok("campagne del pubblico", usato) ?? []) as PubblicoResponse["campagne"],
    clienti,
  };
}

/** Un pubblico nuovo, vuoto oppure copia di un altro: da li' lo si modifica nella sua pagina. */
export async function creaPubblico(input: CreaPubblicoInput, userId: string): Promise<Pubblico> {
  const base = input.copia_da ? await leggiConfigPubblico(input.copia_da) : null;
  const r = await db()
    .from("pubblici")
    .insert({
      nome: input.nome,
      descrizione: input.descrizione?.trim() || null,
      standard: false,
      agenti: base?.agenti ?? [],
      categorie_commerciali: base?.categorie_commerciali ?? ["Attivo"],
      categorie_attivita: base?.categorie_attivita ?? [],
      clienti_extra: base?.clienti_extra ?? [],
      created_by: userId,
      aggiornato_da: userId,
    })
    .select(COLONNE_PUBBLICO)
    .single();
  return ok("creazione pubblico", r) as Pubblico;
}

export async function salvaPubblico(id: string, input: PubblicoInput, userId: string): Promise<PubblicoResponse> {
  await leggiConfigPubblico(id);
  const patch = {
    nome: input.nome,
    descrizione: input.descrizione?.trim() || null,
    agenti: input.agenti,
    categorie_commerciali: input.categorie_commerciali,
    categorie_attivita: [...new Set(input.categorie_attivita)],
    clienti_extra: [...new Set(input.clienti_extra)],
    aggiornato_il: new Date().toISOString(),
    aggiornato_da: userId,
  };
  ok("salvataggio pubblico", await db().from("pubblici").update(patch).eq("id", id).select("id").single());
  return leggiPubblico(id);
}

export async function eliminaPubblico(id: string): Promise<void> {
  const p = await leggiConfigPubblico(id);
  if (p.standard) throw new ErroreCampagne(409, "Il pubblico standard non si può eliminare.");
  const { count } = await db().from("campagne").select("id", { count: "exact", head: true }).eq("pubblico_id", id);
  if ((count ?? 0) > 0) {
    throw new ErroreCampagne(409, `Il pubblico è usato da ${count} campagn${count === 1 ? "a" : "e"}: assegna prima un altro pubblico.`);
  }
  ok("eliminazione pubblico", await db().from("pubblici").delete().eq("id", id).select("id").single());
}

/** Chi ha seguito degli invii, per il filtro della pagina Invii: id e «Nome Cognome». */
export async function utentiInvii(): Promise<{ id: string; nome: string }[]> {
  const ids = ((ok("utenti degli invii", await db().rpc("utenti_invii")) ?? []) as string[]).filter(Boolean);
  if (ids.length === 0) return [];
  const nomi = await nomiUtenti(ids);
  return ids.map((id) => ({ id, nome: nomi.get(id) ?? "Utente non più presente" })).sort((a, b) => a.nome.localeCompare(b.nome));
}

// ─── Clienti per campagne ricevute ─────────────────────────────────────────
/**
 * «Chi ha ricevuto quali campagne»: l'elenco per cliente della pagina Invii.
 * Il filtro vive nel database (`campagne.clienti_per_campagne`): sono pochi migliaia
 * di righe da incrociare e li' si fa con un indice, non scaricandole tutte.
 */
export async function clientiPerCampagne(f: FiltroClientiCampagneInput): Promise<ElencoClientiCampagne> {
  const t = f.q ? pulisciRicerca(f.q) : "";
  const r = await db().rpc("clienti_per_campagne", {
    p_campagne: f.campagna_id && f.campagna_id.length > 0 ? f.campagna_id : null,
    p_modo: f.modo,
    p_min: f.min,
    p_q: t.length >= 2 ? t : null,
    p_limit: f.limit,
    p_offset: f.offset,
  });
  const righe = (ok("clienti per campagne", r) ?? []) as (Omit<ClienteConCampagne, "campagne"> & {
    campagne: ClienteConCampagne["campagne"] | null;
    totale: number | string;
  })[];
  return {
    totale: righe.length > 0 ? Number(righe[0].totale) : 0,
    clienti: righe.map(({ totale: _totale, campagne, ...resto }) => ({ ...resto, campagne: campagne ?? [] })),
  };
}
