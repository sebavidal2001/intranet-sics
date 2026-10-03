import { aBlocchi, db, ErroreCampagne, ok } from "./dati";
import {
  eseguiControllo,
  normNumero,
  type AnomaliaCalcolata,
  type CampagnaCtrl,
  type DdtImpresa,
  type InvioCtrl,
  type InvioStorico,
  type MossaScambio,
  type OrdineImpresa,
  type RigaImpresa,
} from "./controllo";
import type { Anomalia, ControlloEseguito } from "./tipi";

/**
 * Esegue il controllo contro i dati di Impresa gia' caricati dalla pipeline
 * notturna: legge, calcola (`controllo.ts`, funzione pura), scrive.
 *
 * Si puo' rilanciare quando si vuole: scrive solo il risultato del calcolo e non
 * dipende dal passato. Due esecuzioni insieme sono impedite da una riga `in_corso`
 * nello storico, perche' si pesterebbero sulle stesse anomalie.
 */

const MINUTI_BLOCCO = 15;

export interface OpzioniControllo {
  origine: "notturno" | "manuale";
  utenteId: string | null;
  /** Limita il controllo a questi clienti (dopo uno scambio). Vuoto o assente: tutti. */
  clienti?: string[];
}

export interface RiassuntoControllo {
  controllo_id: string;
  dati_del: string | null;
  invii_controllati: number;
  invii_aggiornati: number;
  anomalie_aperte: number;
  anomalie_risolte: number;
  /** Invii dello storico a cui si e' ritrovato il numero d'ordine. */
  storico_ritrovati?: number;
  /** Invii dello storico per cui Impresa non ha una riga con quella data (lacuna dei dati). */
  storico_senza_ordine?: number;
}

export async function eseguiControlloCompleto(o: OpzioniControllo): Promise<RiassuntoControllo> {
  // 1) Una esecuzione per volta. Una `in_corso` piu' vecchia di un quarto d'ora e'
  //    morta (processo ucciso): si chiude, altrimenti bloccherebbe per sempre.
  const limite = new Date(Date.now() - MINUTI_BLOCCO * 60_000).toISOString();
  ok(
    "pulizia controlli",
    await db().from("controlli").update({ esito: "errore", finito_il: new Date().toISOString(), errore: "Interrotto" }).eq("esito", "in_corso").lt("iniziato_il", limite)
  );
  const { count } = await db().from("controlli").select("id", { count: "exact", head: true }).eq("esito", "in_corso");
  if ((count ?? 0) > 0) throw new ErroreCampagne(409, "Un controllo è già in corso: riprova fra qualche minuto.");

  const avvio = ok(
    "avvio controllo",
    await db().from("controlli").insert({ origine: o.origine, eseguito_da: o.utenteId }).select("id").single()
  ) as { id: string };

  try {
    const riassunto = await lavora(avvio.id, o);
    ok(
      "chiusura controllo",
      await db()
        .from("controlli")
        .update({
          esito: "ok",
          finito_il: new Date().toISOString(),
          dati_del: riassunto.dati_del,
          invii_controllati: riassunto.invii_controllati,
          invii_aggiornati: riassunto.invii_aggiornati,
          anomalie_aperte: riassunto.anomalie_aperte,
          anomalie_risolte: riassunto.anomalie_risolte,
        })
        .eq("id", avvio.id)
    );
    return riassunto;
  } catch (e) {
    await db()
      .from("controlli")
      .update({ esito: "errore", finito_il: new Date().toISOString(), errore: e instanceof Error ? e.message.slice(0, 500) : "errore" })
      .eq("id", avvio.id);
    throw e;
  }
}

async function lavora(controlloId: string, o: OpzioniControllo): Promise<RiassuntoControllo> {
  const adesso = new Date().toISOString();
  const soloClienti = o.clienti && o.clienti.length > 0 ? o.clienti : null;

  // 2) LETTURA
  const campagne = (ok("campagne", await db().from("campagne").select("id, codice, nome, articolo_codice, testo_riconoscimento, ordine")) ??
    []) as CampagnaCtrl[];
  const articoli = [...new Set(campagne.map((c) => c.articolo_codice))];
  if (articoli.length === 0) {
    return { controllo_id: controlloId, dati_del: null, invii_controllati: 0, invii_aggiornati: 0, anomalie_aperte: 0, anomalie_risolte: 0 };
  }

  let qInvii = db()
    .from("invii")
    .select("id, campagna_id, codice_cliente, ragione_sociale, stato, ordine_numero, ordine_anno, ordine_profilo, assegnata_il, riga_vista_il")
    .in("stato", ["preparata", "da_spedire"]);
  if (soloClienti) qInvii = qInvii.in("codice_cliente", soloClienti);
  const invii = (ok("invii in lavorazione", await qInvii) ?? []) as InvioCtrl[];

  // Gli invii importati dall'Excel senza numero d'ordine: si ricostruiscono da Impresa.
  let qStorici = db()
    .from("invii")
    .select("id, campagna_id, codice_cliente, stato, data_consegna")
    .eq("origine", "import_excel")
    .in("stato", ["consegnata", "consegnata_banco"])
    .is("ordine_numero", null)
    .not("data_consegna", "is", null);
  if (soloClienti) qStorici = qStorici.in("codice_cliente", soloClienti);
  const storici = (ok("storico senza ordine", await qStorici) ?? []) as InvioStorico[];

  const clientiInvii = [...new Set([...invii.map((i) => i.codice_cliente), ...storici.map((i) => i.codice_cliente)])];
  const datiDel = ok("data dei dati", await db().rpc("impresa_aggiornato_il")) as string | null;

  const [ordini, righe, ddt, righeAperte, collegati] = await Promise.all([
    clientiInvii.length ? rpc<OrdineImpresa>("impresa_ordini", { p_clienti: clientiInvii }) : [],
    clientiInvii.length ? rpc<RigaImpresa>("impresa_righe", { p_articoli: articoli, p_clienti: clientiInvii, p_solo_aperte: false }) : [],
    clientiInvii.length ? rpc<DdtImpresa>("impresa_ddt", { p_articoli: articoli, p_clienti: clientiInvii }) : [],
    rpc<RigaImpresa>("impresa_righe", { p_articoli: articoli, p_clienti: soloClienti, p_solo_aperte: true }),
    db()
      .from("invii")
      .select("codice_cliente, ordine_anno, ordine_numero")
      .neq("stato", "annullata")
      .not("ordine_numero", "is", null)
      .then((r) => (ok("ordini collegati", r) ?? []) as { codice_cliente: string; ordine_anno: number | null; ordine_numero: string | null }[]),
  ]);

  // 3) CALCOLO
  const risultato = eseguiControllo({
    adesso,
    datiDel,
    campagne,
    invii,
    ordini,
    righe,
    righeAperte,
    ddt,
    ordiniCollegati: collegati,
    storici,
  });

  // 4) SCRITTURA DEGLI INVII — condizionata allo stato: se un collega ha agito
  //    nel frattempo (annullata, consegnata a mano) non si sovrascrive.
  let aggiornati = 0;
  for (const a of risultato.aggiornamenti) {
    const r = await db().from("invii").update(a.patch).eq("id", a.id).in("stato", ["preparata", "da_spedire"]).select("id");
    ok("aggiornamento invio", r);
    if (a.cambiaStato || a.adottato) aggiornati++;
  }

  // 4b) STORICO — solo dove il numero e' ancora vuoto: un controllo non riscrive mai
  //      un ordine gia' stabilito (a mano o da un controllo precedente).
  let ritrovati = 0;
  for (const a of risultato.storico) {
    const r = await db().from("invii").update(a.patch).eq("id", a.id).is("ordine_numero", null).select("id");
    ok("ordine dello storico", r);
    if ((r.data ?? []).length > 0) ritrovati++;
  }

  // 5) ANOMALIE
  const { risolte } = await sincronizzaAnomalie(risultato.anomalie, soloClienti, adesso);

  return {
    controllo_id: controlloId,
    dati_del: datiDel,
    invii_controllati: invii.length,
    invii_aggiornati: aggiornati + ritrovati,
    anomalie_aperte: risultato.anomalie.length,
    anomalie_risolte: risolte,
    storico_ritrovati: ritrovati,
    storico_senza_ordine: risultato.storicoSenzaOrdine.length,
  };
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T[]> {
  // Le funzioni tornano al massimo qualche migliaio di righe, ma PostgREST tronca
  // a 1.000: si legge a pagine.
  const tutte: T[] = [];
  for (let da = 0; ; da += 1000) {
    const r = await db().rpc(nome, args).range(da, da + 999);
    const righe = (ok(nome, r) ?? []) as T[];
    tutte.push(...righe);
    if (righe.length < 1000) return tutte;
  }
}

/**
 * Porta la tabella delle anomalie in linea col calcolo:
 *  - nuove  -> inserite;
 *  - ancora vere -> `ultima_vista_il` e dettaglio aggiornati (le ignorate restano ignorate);
 *  - non piu' vere -> chiuse da sole (`automatica`).
 * In un controllo parziale si toccano solo le anomalie dei clienti controllati.
 */
async function sincronizzaAnomalie(
  calcolate: AnomaliaCalcolata[],
  soloClienti: string[] | null,
  adesso: string
): Promise<{ risolte: number }> {
  let qEsistenti = db().from("anomalie").select("id, chiave, stato, codice_cliente").in("stato", ["aperta", "ignorata"]);
  if (soloClienti) qEsistenti = qEsistenti.in("codice_cliente", soloClienti);
  const esistenti = (ok("anomalie esistenti", await qEsistenti) ?? []) as { id: string; chiave: string; stato: string }[];
  const perChiave = new Map(esistenti.map((e) => [e.chiave, e]));
  const volute = new Set(calcolate.map((c) => c.chiave));

  const daInserire = calcolate.filter((c) => !perChiave.has(c.chiave));
  for (const blocco of aBlocchi(daInserire, 200)) {
    ok(
      "nuove anomalie",
      await db().from("anomalie").insert(
        blocco.map((c) => ({
          tipo: c.tipo,
          gravita: c.gravita,
          chiave: c.chiave,
          codice_cliente: c.codice_cliente,
          ragione_sociale: c.ragione_sociale,
          invio_id: c.invio_id,
          campagna_id: c.campagna_id,
          ordine_numero: c.ordine_numero,
          ordine_anno: c.ordine_anno,
          dettaglio: c.dettaglio,
          aperta_il: adesso,
          ultima_vista_il: adesso,
        }))
      )
    );
  }

  for (const c of calcolate) {
    const e = perChiave.get(c.chiave);
    if (!e) continue;
    const patch: Record<string, unknown> = { ultima_vista_il: adesso };
    if (e.stato === "aperta") {
      patch.dettaglio = c.dettaglio;
      patch.ragione_sociale = c.ragione_sociale;
    }
    ok("anomalia ancora vera", await db().from("anomalie").update(patch).eq("id", e.id));
  }

  const daChiudere = esistenti.filter((e) => !volute.has(e.chiave)).map((e) => e.id);
  for (const blocco of aBlocchi(daChiudere, 100)) {
    ok(
      "anomalie risolte",
      await db().from("anomalie").update({ stato: "risolta", risolta_il: adesso, risolta_con: "automatica" }).in("id", blocco)
    );
  }
  return { risolte: daChiudere.length };
}

// ─── Scambio di ordini fra invii ───────────────────────────────────────────
/**
 * Applica lo scambio proposto da una anomalia `ordine_invertito`. Prima verifica
 * che gli invii siano ancora come li aveva visti il controllo (qualcuno potrebbe
 * averli gia' cambiati), poi scambia in un'unica transazione (funzione SQL) e
 * chiude l'anomalia. Si scambiano solo i riferimenti all'ordine: il referente
 * resta con la busta.
 */
export async function applicaScambio(anomaliaId: string, userId: string): Promise<Anomalia> {
  const a = ok("lettura anomalia", await db().from("anomalie").select("*").eq("id", anomaliaId).maybeSingle()) as Anomalia | null;
  if (!a) throw new ErroreCampagne(404, "Anomalia non trovata.");
  if (a.tipo !== "ordine_invertito") throw new ErroreCampagne(400, "Questa anomalia non prevede uno scambio.");
  if (a.stato !== "aperta") throw new ErroreCampagne(409, "L'anomalia non è più aperta: ricarica la pagina.");

  const mosse = (a.dettaglio.mosse ?? []) as MossaScambio[];
  if (mosse.length < 2) throw new ErroreCampagne(409, "Lo scambio proposto non è valido: rilancia il controllo.");

  const correnti = (ok(
    "invii dello scambio",
    await db()
      .from("invii")
      .select("id, stato, ordine_numero, ordine_anno")
      .in("id", mosse.map((m) => m.invio_id))
  ) ?? []) as { id: string; stato: string; ordine_numero: string | null; ordine_anno: number | null }[];

  for (const m of mosse) {
    const c = correnti.find((x) => x.id === m.invio_id);
    const ancoraCosi =
      c &&
      (c.stato === "preparata" || c.stato === "da_spedire") &&
      normNumero(c.ordine_numero) === normNumero(m.da.ordine_numero) &&
      c.ordine_anno === m.da.ordine_anno;
    if (!ancoraCosi) {
      throw new ErroreCampagne(409, "Gli invii sono cambiati dopo l'ultimo controllo: ricontrolla e riprova.");
    }
  }

  ok(
    "scambio degli ordini",
    await db().rpc("riassegna_ordini", {
      p_mosse: mosse.map((m) => ({
        invio_id: m.invio_id,
        ordine_numero: m.a.ordine_numero,
        ordine_anno: m.a.ordine_anno,
        ordine_profilo: m.a.ordine_profilo,
        ordine_data: m.a.ordine_data,
        ordine_data_consegna: m.a.ordine_data_consegna,
      })),
    })
  );

  const chiusa = ok(
    "chiusura anomalia",
    await db()
      .from("anomalie")
      .update({ stato: "risolta", risolta_il: new Date().toISOString(), risolta_con: "scambio", risolta_da: userId })
      .eq("id", anomaliaId)
      .select("*")
      .single()
  ) as Anomalia;

  // Ricontrollo il solo cliente: l'anomalia nuova, se ce n'e', compare subito.
  try {
    await eseguiControlloCompleto({ origine: "manuale", utenteId: userId, clienti: [a.codice_cliente] });
  } catch {
    // Un controllo gia' in corso non deve far fallire uno scambio riuscito.
  }
  return chiusa;
}

export async function leggiUltimiControlli(n = 10): Promise<ControlloEseguito[]> {
  const r = await db().from("controlli").select("*").order("iniziato_il", { ascending: false }).limit(n);
  return (ok("storico controlli", r) ?? []) as ControlloEseguito[];
}
