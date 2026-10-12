/**
 * RILEVATORI SUI DATI CHE PRIMA IL BRIEFING NON LEGGEVA.
 *
 * I tredici rilevatori di `rilevatori.ts` guardano ordinato, fatturato,
 * preventivi e acquisti. Qui entrano gli altri dataset dello snapshot:
 * scadenzario, condizioni di pagamento e fatture fornitore (migration 150),
 * visite dei commerciali (145), articoli, variazioni di costo e spedizioni (152).
 *
 * Stesse regole degli altri:
 *  · deterministici: niente AI, i numeri sono calcolati qui;
 *  · soglie alte, si abbassano dopo;
 *  · la magnitudine e' in EURO. Dove il fatto non ha euro propri (visite,
 *    dipendenza da un vettore) pesa una quota dichiarata di un valore vero e
 *    il dettaglio lo dice;
 *  · un dataset assente (vista non raggiungibile) non e' un errore: il
 *    rilevatore non produce niente.
 *
 * Con `ctx.agente` valorizzato (briefing di un singolo agente) restano solo i
 * rilevatori che sanno risalire all'agente; quelli di cassa, magazzino e
 * trasporto sono dell'azienda e tacciono.
 *
 * Pagina del Vault: «BI - Segnali del briefing».
 */

import { preventivoInCorso } from "./semantico";
import { PROFILI_FATTURA_CLIENTE, PROFILI_FATTURA_FORNITORE } from "./fornitori";
import { dataDaIso, iso } from "./calendario";
import type { ContestoRilevatori } from "./rilevatori";
import type { RigaFatto, Segnale, Snapshot } from "./tipi";

export const SOGLIE_ESTESE = {
  /** Incassi scaduti: totale minimo per parlarne. */
  incassiScadutiMinimoEuro: 20_000,
  /** Quota dei primi tre clienti oltre la quale lo scaduto "e' di pochi". */
  incassiConcentrazionePct: 50,
  /** Pagamenti ai fornitori: finestra e totale minimo (scaduti compresi). */
  pagamentiGiorni: 14,
  pagamentiMinimoEuro: 30_000,
  /** Cassa: finestra e saldo settimanale negativo minimo. */
  cassaGiorni: 30,
  cassaSettimanaMinimaEuro: 20_000,
  /** Clienti che pagano piu' tardi: finestre, giorni di scarto, importo minimo. */
  pagamentoGiorniRecenti: 180,
  pagamentoGiorniBase: 365,
  pagamentoScartoGiorni: 10,
  pagamentoFatturePerFinestra: 3,
  pagamentoMinimoClienteEuro: 10_000,
  pagamentoMinimoEuro: 15_000,
  /** Articoli scoperti: valore minimo del mancante, al costo. */
  scopertoMinimoEuro: 10_000,
  /** Giacenza ferma: mesi senza movimenti e valore minimo. */
  giacenzaFermaGiorni: 365,
  giacenzaFermaMinimoEuro: 30_000,
  /** Rincari recenti: giorni, percentuale, articoli e impatto minimi. */
  rincaroGiorni: 90,
  rincaroPct: 5,
  rincaroArticoliMinimi: 3,
  rincaroImpattoMinimoEuro: 5_000,
  /** Visite: clienti che ordinano e non si vedono da tanto. */
  visiteSilenzioGiorni: 180,
  visiteClienteMinimoEuro: 10_000,
  visiteSilenzioMinimoEuro: 50_000,
  visiteSilenzioClientiMinimi: 5,
  /** Visite con prossima visita saltata. */
  seguitoGiorniMinimi: 14,
  seguitoGiorniMassimi: 120,
  seguitoClientiMinimi: 8,
  /** Visite per provincia: minimo nella base e calo. */
  visiteProvinciaBaseMinima: 15,
  visiteProvinciaCaloPct: 40,
  /** Preventivi presentati in visita e rimasti senza ordine. */
  preventivoVisitaGiorniMinimi: 21,
  preventivoVisitaGiorniMassimi: 120,
  preventivoVisitaClienteMinimoEuro: 3_000,
  preventivoVisitaMinimoEuro: 20_000,
  /** Quota dichiarata del valore del cliente che pesa un fatto senza euro propri. */
  quotaPesoSenzaEuro: 0.1,
  /** Trasporto: scarto del costo per 100 kg, volumi e impatto minimi. */
  trasportoScartoPct: 15,
  trasportoPesoRecenteMinimoKg: 5_000,
  trasportoImpattoMinimoEuro: 1_500,
  /** Un vettore su cui passa questa quota dei documenti in uscita. */
  vettoreQuotaPct: 70,
  vettoreDocumentiMinimi: 60,
  /** Fatture fornitore senza ordine: totale e quota minimi. */
  fattureSenzaOrdineMinimoEuro: 20_000,
  fattureSenzaOrdineQuotaPct: 20,
  /** Dipendenza da un fornitore. */
  dipendenzaQuotaPct: 40,
  dipendenzaTotaleMinimoEuro: 100_000,
  /** Clienti che ordinano senza un agente. */
  senzaAgenteMinimoEuro: 20_000,
  senzaAgenteClientiMinimi: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilita' locali (copie minime: rilevatori.ts le tiene private e importarlo
// da qui creerebbe un giro fra i due file)
// ─────────────────────────────────────────────────────────────────────────────

const arr = (n: number) => Math.round(n * 100) / 100;
const pct = (parte: number, totale: number) => (totale ? arr((parte / totale) * 100) : 0);
const euroTesto = (n: number) => `${Math.round(n).toLocaleString("it-IT")} €`;

function giorniTra(a: string, b: string): number {
  return Math.round((dataDaIso(b).getTime() - dataDaIso(a).getTime()) / 86_400_000);
}

function spostaGiorni(data: string, giorni: number): string {
  const d = dataDaIso(data);
  d.setUTCDate(d.getUTCDate() + giorni);
  return iso(d);
}

type ChiaveEstesa =
  | "fatture_fornitore"
  | "pagamenti"
  | "scadenze"
  | "visite"
  | "articoli"
  | "variazioni_costo"
  | "spedizioni"
  | "ordinato"
  | "fatturato"
  | "consegnato"
  | "preventivi_aperti";

function dataset(ctx: ContestoRilevatori, chiave: ChiaveEstesa): RigaFatto[] {
  return (ctx.snapshot.dataset[chiave] as RigaFatto[] | undefined) ?? [];
}

const chiaveCliente = (r: RigaFatto) => r.codiceCliente || r.cliente;

function righeAgente(ctx: ContestoRilevatori, righe: RigaFatto[]): RigaFatto[] {
  return ctx.agente ? righe.filter((r) => r.agente === ctx.agente) : righe;
}

/** Quanto ha ordinato ogni cliente negli ultimi 12 mesi (nello scope dell'agente). */
function ordinato12Mesi(ctx: ContestoRilevatori): Map<string, { cliente: string; agente: string; valore: number; ultimo: string }> {
  const da = spostaGiorni(ctx.oggi, -365);
  const m = new Map<string, { cliente: string; agente: string; valore: number; ultimo: string }>();
  for (const r of righeAgente(ctx, dataset(ctx, "ordinato"))) {
    if (!r.data || r.data <= da || r.data > ctx.oggi) continue;
    const k = chiaveCliente(r);
    if (!k) continue;
    const c = m.get(k) ?? { cliente: r.cliente, agente: r.agente, valore: 0, ultimo: r.data };
    c.valore += r.importo;
    if (r.data >= c.ultimo) {
      c.ultimo = r.data;
      c.agente = r.agente;
    }
    m.set(k, c);
  }
  return m;
}

/** Agente di ogni cliente, dall'ultimo ordine: serve a dare un agente ai dati che non lo portano. */
const cacheAgenti = new WeakMap<Snapshot, Map<string, string>>();
function agentePerCliente(ctx: ContestoRilevatori): Map<string, string> {
  const nota = cacheAgenti.get(ctx.snapshot);
  if (nota) return nota;
  const ultima = new Map<string, { data: string; agente: string }>();
  for (const r of dataset(ctx, "ordinato")) {
    const k = chiaveCliente(r);
    if (!k || !r.agente) continue;
    const c = ultima.get(k);
    if (!c || r.data >= c.data) ultima.set(k, { data: r.data, agente: r.agente });
  }
  const m = new Map<string, string>();
  for (const [k, v] of ultima) m.set(k, v.agente);
  cacheAgenti.set(ctx.snapshot, m);
  return m;
}

function clienteNelloScope(ctx: ContestoRilevatori, chiave: string): boolean {
  return !ctx.agente || agentePerCliente(ctx).get(chiave) === ctx.agente;
}

function classifica<T extends { valore: number }>(mappa: Map<string, T>, n: number): Array<T & { chiave: string }> {
  return [...mappa.entries()]
    .map(([chiave, v]) => ({ chiave, ...v }))
    .sort((a, b) => b.valore - a.valore)
    .slice(0, n);
}

// ─────────────────────────────────────────────────────────────────────────────
// 14 — Incassi scaduti
// Scadenze «A» con la data passata e il saldo ancora aperto, da scadenzario.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaIncassiScaduti(ctx: ContestoRilevatori): Segnale[] {
  const righe = dataset(ctx, "scadenze").filter(
    (r) => r.tipoScadenza === "A" && r.data && r.data < ctx.oggi && (r.saldoAperto ?? 0) > 0
  );
  const filtrate = ctx.agente ? righe.filter((r) => clienteNelloScope(ctx, chiaveCliente(r))) : righe;
  if (filtrate.length === 0) return [];

  const fasce = { fino30: 0, fino90: 0, oltre90: 0, oltreAnno: 0 };
  const perCliente = new Map<string, { cliente: string; valore: number; giorniMax: number }>();
  let totale = 0;
  for (const r of filtrate) {
    const saldo = r.saldoAperto ?? 0;
    const giorni = giorniTra(r.data, ctx.oggi);
    totale += saldo;
    if (giorni <= 30) fasce.fino30 += saldo;
    else if (giorni <= 90) fasce.fino90 += saldo;
    else if (giorni <= 365) fasce.oltre90 += saldo;
    else fasce.oltreAnno += saldo;
    const k = chiaveCliente(r) || r.soggetto || "(senza cliente)";
    const c = perCliente.get(k) ?? { cliente: r.cliente || r.soggetto || k, valore: 0, giorniMax: 0 };
    c.valore += saldo;
    c.giorniMax = Math.max(c.giorniMax, giorni);
    perCliente.set(k, c);
  }
  totale = arr(totale);
  if (totale < SOGLIE_ESTESE.incassiScadutiMinimoEuro) return [];

  const primi = classifica(perCliente, 5).map((c) => ({ ...c, valore: arr(c.valore) }));
  const quotaPrimiTre = pct(primi.slice(0, 3).reduce((t, c) => t + c.valore, 0), totale);
  const concentrato = quotaPrimiTre >= SOGLIE_ESTESE.incassiConcentrazionePct && perCliente.size > 3;
  const oltre90 = arr(fasce.oltre90 + fasce.oltreAnno);

  return [
    {
      id: "incassi-scaduti",
      famiglia: "incassi_scaduti",
      titolo: concentrato
        ? `${euroTesto(totale)} di incassi scaduti, il ${quotaPrimiTre}% su tre clienti`
        : `${euroTesto(totale)} di incassi scaduti da ${perCliente.size} clienti`,
      descrizione:
        `Lo scadenzario ha ${euroTesto(totale)} di incassi con la data passata e il saldo aperto, ` +
        `da ${perCliente.size} clienti. Scaduti da oltre 90 giorni: ${euroTesto(oltre90)}` +
        (fasce.oltreAnno > 0 ? ` (di cui ${euroTesto(fasce.oltreAnno)} da oltre un anno)` : "") +
        `. I primi: ` +
        primi
          .slice(0, 3)
          .map((c) => `${c.cliente} ${euroTesto(c.valore)} (${c.giorniMax} giorni)`)
          .join("; ") +
        ".",
      magnitudineEuro: totale,
      persistenza: 0.9,
      azionabilita: 0.9,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { totale, fasce, clienti: primi, quotaPrimiTre, numeroClienti: perCliente.size },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 15 — Pagamenti ai fornitori da fare
// Scadenze «P» gia' scadute o in scadenza nei prossimi giorni.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaPagamentiFornitori(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const fine = spostaGiorni(ctx.oggi, SOGLIE_ESTESE.pagamentiGiorni);
  const righe = dataset(ctx, "scadenze").filter(
    (r) => r.tipoScadenza === "P" && r.data && r.data <= fine && (r.saldoAperto ?? 0) > 0
  );
  if (righe.length === 0) return [];

  let scaduto = 0;
  let inScadenza = 0;
  const perFornitore = new Map<string, { fornitore: string; valore: number }>();
  for (const r of righe) {
    const saldo = r.saldoAperto ?? 0;
    if (r.data < ctx.oggi) scaduto += saldo;
    else inScadenza += saldo;
    const k = r.fornitore || r.soggetto || "(senza fornitore)";
    const f = perFornitore.get(k) ?? { fornitore: k, valore: 0 };
    f.valore += saldo;
    perFornitore.set(k, f);
  }
  const totale = arr(scaduto + inScadenza);
  if (totale < SOGLIE_ESTESE.pagamentiMinimoEuro) return [];
  const primi = classifica(perFornitore, 5).map((f) => ({ fornitore: f.fornitore, valore: arr(f.valore) }));

  return [
    {
      id: "pagamenti-fornitori",
      famiglia: "pagamenti_fornitori",
      titolo:
        scaduto > 0
          ? `${euroTesto(totale)} da pagare ai fornitori, ${euroTesto(scaduto)} già scaduti`
          : `${euroTesto(totale)} da pagare ai fornitori entro ${SOGLIE_ESTESE.pagamentiGiorni} giorni`,
      descrizione:
        `Allo scadenzario i pagamenti dovuti ai fornitori fino a ${SOGLIE_ESTESE.pagamentiGiorni} giorni da oggi valgono ${euroTesto(totale)}: ` +
        `${euroTesto(scaduto)} già scaduti e ${euroTesto(inScadenza)} in scadenza. ` +
        `I primi fornitori: ${primi.slice(0, 3).map((f) => `${f.fornitore} ${euroTesto(f.valore)}`).join("; ")}.`,
      magnitudineEuro: totale,
      persistenza: 0.5,
      azionabilita: 0.8,
      direzione: scaduto > 0 ? "negativo" : "neutro",
      punteggio: 0,
      prove: [],
      dettaglio: { scaduto: arr(scaduto), inScadenza: arr(inScadenza), fornitori: primi },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 16 — Cassa dei prossimi 30 giorni
// Incassi attesi contro pagamenti dovuti, settimana per settimana. Non e' un
// saldo di banca (manca il conto): dice dove escono piu' soldi di quanti ne
// entrano.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaCassaProssimi30(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const fine = spostaGiorni(ctx.oggi, SOGLIE_ESTESE.cassaGiorni);
  const righe = dataset(ctx, "scadenze").filter(
    (r) => r.data && r.data >= ctx.oggi && r.data <= fine && (r.saldoAperto ?? 0) > 0
  );
  if (righe.length === 0) return [];

  const settimane = Array.from({ length: Math.ceil(SOGLIE_ESTESE.cassaGiorni / 7) }, (_, i) => ({
    dal: spostaGiorni(ctx.oggi, i * 7),
    incassi: 0,
    pagamenti: 0,
  }));
  let incassi = 0;
  let pagamenti = 0;
  for (const r of righe) {
    const i = Math.min(settimane.length - 1, Math.floor(giorniTra(ctx.oggi, r.data) / 7));
    const saldo = r.saldoAperto ?? 0;
    if (r.tipoScadenza === "P") {
      settimane[i].pagamenti += saldo;
      pagamenti += saldo;
    } else {
      settimane[i].incassi += saldo;
      incassi += saldo;
    }
  }
  const netto = arr(incassi - pagamenti);
  const peggiore = settimane
    .map((s) => ({ ...s, netto: arr(s.incassi - s.pagamenti) }))
    .sort((a, b) => a.netto - b.netto)[0];
  if (peggiore.netto > -SOGLIE_ESTESE.cassaSettimanaMinimaEuro) return [];

  return [
    {
      id: "cassa-30-giorni",
      famiglia: "cassa_30_giorni",
      titolo: `Settimana dal ${peggiore.dal.slice(8, 10)}/${peggiore.dal.slice(5, 7)}: escono ${euroTesto(-peggiore.netto)} più di quanto entra`,
      descrizione:
        `Nei prossimi ${SOGLIE_ESTESE.cassaGiorni} giorni lo scadenzario prevede ${euroTesto(incassi)} di incassi e ${euroTesto(pagamenti)} di pagamenti ` +
        `(netto ${netto < 0 ? "-" : ""}${euroTesto(Math.abs(netto))}). La settimana più scoperta è quella dal ${peggiore.dal}: ` +
        `${euroTesto(peggiore.incassi)} in entrata contro ${euroTesto(peggiore.pagamenti)} in uscita. ` +
        `Sono scadenze aperte: non comprendono il saldo di banca né i ritardi di incasso.`,
      magnitudineEuro: Math.abs(peggiore.netto),
      persistenza: 0.4,
      azionabilita: 0.6,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { incassi: arr(incassi), pagamenti: arr(pagamenti), netto, settimane: settimane.map((s) => ({ dal: s.dal, incassi: arr(s.incassi), pagamenti: arr(s.pagamenti) })) },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 17 — Clienti che pagano piu' tardi di prima
// Giorni medi fra fattura e scadenze, pesati sull'importo, ultime fatture contro
// quelle dei dodici mesi prima. Non usa la condizione scritta: confronta il
// cliente con se' stesso.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaClientiPaganoTardi(ctx: ContestoRilevatori): Segnale[] {
  const righe = dataset(ctx, "pagamenti").filter(
    (r) =>
      PROFILI_FATTURA_CLIENTE.has(r.profilo ?? "") &&
      r.giorniMedi != null &&
      (r.importoScadenze ?? 0) > 0 &&
      r.data &&
      r.data <= ctx.oggi
  );
  if (righe.length === 0) return [];
  const inizioRecente = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.pagamentoGiorniRecenti);
  const inizioBase = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.pagamentoGiorniBase - SOGLIE_ESTESE.pagamentoGiorniRecenti);

  type Finestra = { n: number; peso: number; giorni: number };
  const perCliente = new Map<string, { cliente: string; ora: Finestra; prima: Finestra }>();
  for (const r of righe) {
    if (r.data <= inizioBase) continue;
    const k = chiaveCliente(r);
    if (!k || !clienteNelloScope(ctx, k)) continue;
    const c = perCliente.get(k) ?? {
      cliente: r.cliente,
      ora: { n: 0, peso: 0, giorni: 0 },
      prima: { n: 0, peso: 0, giorni: 0 },
    };
    const f = r.data > inizioRecente ? c.ora : c.prima;
    const peso = r.importoScadenze ?? 0;
    f.n += 1;
    f.peso += peso;
    f.giorni += (r.giorniMedi ?? 0) * peso;
    perCliente.set(k, c);
  }

  const tardivi = [...perCliente.values()]
    .filter(
      (c) =>
        c.ora.n >= SOGLIE_ESTESE.pagamentoFatturePerFinestra &&
        c.prima.n >= SOGLIE_ESTESE.pagamentoFatturePerFinestra &&
        c.ora.peso >= SOGLIE_ESTESE.pagamentoMinimoClienteEuro
    )
    .map((c) => {
      const ora = c.ora.giorni / c.ora.peso;
      const prima = c.prima.giorni / c.prima.peso;
      return { cliente: c.cliente, giorniOra: arr(ora), giorniPrima: arr(prima), scarto: arr(ora - prima), fatturato: arr(c.ora.peso), fatture: c.ora.n };
    })
    .filter((c) => c.scarto >= SOGLIE_ESTESE.pagamentoScartoGiorni)
    .sort((a, b) => b.fatturato - a.fatturato);

  if (tardivi.length === 0) return [];
  const esposto = arr(tardivi.reduce((t, c) => t + c.fatturato, 0));
  if (esposto < SOGLIE_ESTESE.pagamentoMinimoEuro) return [];
  const primi = tardivi.slice(0, 4);

  return [
    {
      id: "clienti-pagano-tardi",
      famiglia: "clienti_pagano_tardi",
      titolo: `${tardivi.length} clienti pagano con più giorni di ritardo di prima`,
      descrizione:
        `${tardivi.length} clienti hanno scadenze più lunghe nelle fatture degli ultimi ${SOGLIE_ESTESE.pagamentoGiorniRecenti} giorni ` +
        `rispetto ai ${SOGLIE_ESTESE.pagamentoGiorniBase} precedenti, per ${euroTesto(esposto)} di fatture recenti: ` +
        primi.map((c) => `${c.cliente} da ${c.giorniPrima} a ${c.giorniOra} giorni medi`).join("; ") +
        ".",
      magnitudineEuro: esposto,
      persistenza: 0.7,
      azionabilita: 0.8,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { clienti: tardivi.slice(0, 15), totaleClienti: tardivi.length, esposto },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 18 — Articoli scoperti
// Ordini dei clienti ancora aperti che superano esistenza piu' ordini al
// fornitore. Non usa `disponibilita` del gestionale (non so cosa conteggi):
// somma i tre numeri che si vedono.
// ─────────────────────────────────────────────────────────────────────────────

function perArticolo(ctx: ContestoRilevatori) {
  const m = new Map<
    string,
    { articolo: string; descrizione: string; esistenza: number; ordClienti: number; ordFornitori: number; costo: number | null; valoreGiacenza: number; fornitore: string }
  >();
  for (const r of dataset(ctx, "articoli")) {
    const k = (r.articolo || r.documento).toUpperCase();
    if (!k) continue;
    const a = m.get(k) ?? {
      articolo: k,
      descrizione: r.descrizioneArticolo,
      esistenza: 0,
      ordClienti: 0,
      ordFornitori: 0,
      costo: null,
      valoreGiacenza: 0,
      fornitore: r.fornitore ?? "",
    };
    a.esistenza += r.esistenza ?? 0;
    a.ordClienti += r.qtaOrdClienti ?? 0;
    a.ordFornitori += r.qtaOrdFornitori ?? 0;
    a.valoreGiacenza += r.valoreGiacenza ?? 0;
    if (r.ultimoCosto != null && (a.costo === null || r.ultimoCosto > a.costo)) a.costo = r.ultimoCosto;
    m.set(k, a);
  }
  return m;
}

function rilevaArticoliScoperti(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const scoperti = [...perArticolo(ctx).values()]
    .map((a) => {
      const mancante = a.ordClienti - Math.max(a.esistenza, 0) - a.ordFornitori;
      return { ...a, mancante, valore: mancante > 0 && a.costo ? mancante * a.costo : 0, senzaOrdine: a.ordFornitori <= 0 && a.ordClienti > Math.max(a.esistenza, 0) };
    })
    .filter((a) => a.mancante > 0 && a.valore > 0)
    .sort((a, b) => b.valore - a.valore);
  if (scoperti.length === 0) return [];

  const valore = arr(scoperti.reduce((t, a) => t + a.valore, 0));
  if (valore < SOGLIE_ESTESE.scopertoMinimoEuro) return [];
  const senzaOrdine = scoperti.filter((a) => a.senzaOrdine);
  const valoreSenzaOrdine = arr(senzaOrdine.reduce((t, a) => t + a.valore, 0));
  const primi = scoperti.slice(0, 5).map((a) => ({
    articolo: a.articolo,
    descrizione: a.descrizione,
    mancante: arr(a.mancante),
    valoreAlCosto: arr(a.valore),
    senzaOrdineFornitore: a.senzaOrdine,
  }));

  return [
    {
      id: "articoli-scoperti",
      famiglia: "articoli_scoperti",
      titolo: `${scoperti.length} articoli con ordini cliente oltre giacenza e ordini a fornitore`,
      descrizione:
        `${scoperti.length} articoli hanno ordini cliente aperti superiori a giacenza più ordinato a fornitore: ` +
        `mancano merci per ${euroTesto(valore)} al costo. ` +
        `${senzaOrdine.length} non hanno nessun ordine a fornitore in arrivo (${euroTesto(valoreSenzaOrdine)}). ` +
        `I primi: ${primi.slice(0, 3).map((a) => `${a.articolo} (${a.mancante} pezzi)`).join("; ")}.`,
      magnitudineEuro: valore,
      persistenza: 0.7,
      azionabilita: 0.9,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { articoli: primi, totaleArticoli: scoperti.length, valore, senzaOrdine: senzaOrdine.length, valoreSenzaOrdine },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 19 — Giacenza ferma
// Esistenza di valore su articoli che non compaiono in nessun ordine,
// consegna o fattura da un anno e non hanno ordini cliente aperti.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaGiacenzaFerma(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const articoli = perArticolo(ctx);
  if (articoli.size === 0) return [];
  const da = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.giacenzaFermaGiorni);
  const mossi = new Set<string>();
  for (const chiave of ["ordinato", "fatturato", "consegnato"] as const) {
    for (const r of dataset(ctx, chiave)) {
      if (r.articolo && r.data > da) mossi.add(r.articolo.toUpperCase());
    }
  }
  // Senza movimenti di vendita caricati non si puo' dire che nulla si muova.
  if (mossi.size === 0) return [];

  const valoreTotale = [...articoli.values()].reduce((t, a) => t + a.valoreGiacenza, 0);
  const ferme = [...articoli.values()]
    .filter((a) => a.esistenza > 0 && a.valoreGiacenza > 0 && a.ordClienti <= 0 && !mossi.has(a.articolo))
    .sort((a, b) => b.valoreGiacenza - a.valoreGiacenza);
  if (ferme.length === 0) return [];

  const valore = arr(ferme.reduce((t, a) => t + a.valoreGiacenza, 0));
  if (valore < SOGLIE_ESTESE.giacenzaFermaMinimoEuro) return [];
  const primi = ferme.slice(0, 8).map((a) => ({ articolo: a.articolo, descrizione: a.descrizione, esistenza: arr(a.esistenza), valore: arr(a.valoreGiacenza), fornitore: a.fornitore }));
  const quota = pct(valore, valoreTotale);

  return [
    {
      id: "giacenza-ferma",
      famiglia: "giacenza_ferma",
      titolo: `${euroTesto(valore)} di giacenza senza movimenti da un anno`,
      descrizione:
        `${ferme.length} articoli in magazzino, per ${euroTesto(valore)} all'ultimo costo (${quota}% del valore di giacenza), ` +
        `non compaiono in ordini, consegne o fatture degli ultimi ${SOGLIE_ESTESE.giacenzaFermaGiorni} giorni e non hanno ordini cliente aperti. ` +
        `I più pesanti: ${primi.slice(0, 3).map((a) => `${a.articolo} ${euroTesto(a.valore)}`).join("; ")}.`,
      magnitudineEuro: valore,
      persistenza: 1,
      azionabilita: 0.6,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { articoli: primi, totaleArticoli: ferme.length, valore, quotaGiacenza: quota },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 20 — Rincari recenti su articoli in magazzino
// Ultima variazione di costo degli ultimi 90 giorni, in salita, sugli articoli
// con esistenza: la differenza e' gia' nel valore della giacenza e va nei
// listini di vendita.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaRincariRecenti(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const variazioni = dataset(ctx, "variazioni_costo");
  if (variazioni.length === 0) return [];
  const giacenze = perArticolo(ctx);
  const da = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.rincaroGiorni);

  const ultima = new Map<string, RigaFatto>();
  for (const r of variazioni) {
    if (!r.data || r.data <= da || r.data > ctx.oggi) continue;
    const k = r.articolo.toUpperCase();
    const prec = ultima.get(k);
    if (!prec || r.data >= prec.data) ultima.set(k, r);
  }
  const rincari = [...ultima.entries()]
    .map(([k, r]) => {
      const g = giacenze.get(k);
      const esistenza = g ? Math.max(g.esistenza, 0) : 0;
      return { articolo: k, descrizione: r.descrizioneArticolo, data: r.data, pct: r.variazionePct ?? 0, delta: r.importo, esistenza, impatto: r.importo > 0 ? r.importo * esistenza : 0 };
    })
    .filter((x) => x.pct >= SOGLIE_ESTESE.rincaroPct && x.impatto > 0)
    .sort((a, b) => b.impatto - a.impatto);

  if (rincari.length < SOGLIE_ESTESE.rincaroArticoliMinimi) return [];
  const impatto = arr(rincari.reduce((t, x) => t + x.impatto, 0));
  if (impatto < SOGLIE_ESTESE.rincaroImpattoMinimoEuro) return [];
  const primi = rincari.slice(0, 8).map((x) => ({ ...x, pct: arr(x.pct), delta: arr(x.delta), impatto: arr(x.impatto), esistenza: arr(x.esistenza) }));

  return [
    {
      id: "rincari-recenti",
      famiglia: "rincari_recenti",
      titolo: `${rincari.length} articoli in magazzino hanno rincarato negli ultimi ${SOGLIE_ESTESE.rincaroGiorni} giorni`,
      descrizione:
        `${rincari.length} articoli con giacenza hanno avuto un aumento dell'ultimo costo di almeno il ${SOGLIE_ESTESE.rincaroPct}% ` +
        `negli ultimi ${SOGLIE_ESTESE.rincaroGiorni} giorni; sulla giacenza attuale la differenza vale ${euroTesto(impatto)}. ` +
        `I più pesanti: ${primi.slice(0, 3).map((x) => `${x.articolo} +${x.pct}%`).join("; ")}.`,
      magnitudineEuro: impatto,
      persistenza: 0.5,
      azionabilita: 0.7,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { articoli: primi, totaleArticoli: rincari.length, impatto },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 21 — Clienti che ordinano e non si vedono da mesi
// ─────────────────────────────────────────────────────────────────────────────

function ultimaVisitaPerCliente(ctx: ContestoRilevatori): Map<string, { data: string; agente: string }> {
  const m = new Map<string, { data: string; agente: string }>();
  for (const r of dataset(ctx, "visite")) {
    const k = chiaveCliente(r);
    if (!k || !r.data || r.data > ctx.oggi) continue;
    const c = m.get(k);
    if (!c || r.data >= c.data) m.set(k, { data: r.data, agente: r.agente });
  }
  return m;
}

function rilevaClientiSenzaVisite(ctx: ContestoRilevatori): Segnale[] {
  if (dataset(ctx, "visite").length === 0) return [];
  const visite = ultimaVisitaPerCliente(ctx);
  const limite = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.visiteSilenzioGiorni);

  const nonAttivi = new Set(
    righeAgente(ctx, dataset(ctx, "ordinato"))
      .filter((r) => r.clienteAttivo === "Non attivo")
      .map(chiaveCliente)
  );
  const senza = [...ordinato12Mesi(ctx).entries()]
    .filter(([k, c]) => c.valore >= SOGLIE_ESTESE.visiteClienteMinimoEuro && !nonAttivi.has(k))
    .map(([k, c]) => {
      const v = visite.get(k);
      return { cliente: c.cliente, agente: c.agente, ordinato12Mesi: arr(c.valore), ultimaVisita: v?.data ?? null };
    })
    .filter((c) => c.ultimaVisita === null || c.ultimaVisita <= limite)
    .sort((a, b) => b.ordinato12Mesi - a.ordinato12Mesi);

  const valore = arr(senza.reduce((t, c) => t + c.ordinato12Mesi, 0));
  if (senza.length < SOGLIE_ESTESE.visiteSilenzioClientiMinimi || valore < SOGLIE_ESTESE.visiteSilenzioMinimoEuro) return [];

  const perAgente = new Map<string, number>();
  for (const c of senza) perAgente.set(c.agente, (perAgente.get(c.agente) ?? 0) + 1);
  const [agentePrincipale] = [...perAgente.entries()].sort((a, b) => b[1] - a[1]);
  const mai = senza.filter((c) => c.ultimaVisita === null).length;

  return [
    {
      id: "clienti-senza-visite",
      famiglia: "clienti_senza_visite",
      titolo: `${senza.length} clienti che ordinano non sono visitati da oltre ${SOGLIE_ESTESE.visiteSilenzioGiorni} giorni`,
      descrizione:
        `${senza.length} clienti hanno ordinato ${euroTesto(valore)} negli ultimi 12 mesi e non hanno visite negli ultimi ${SOGLIE_ESTESE.visiteSilenzioGiorni} giorni` +
        (mai > 0 ? ` (${mai} non risultano visitati dal 2024)` : "") +
        `. ` +
        (agentePrincipale ? `Il portafoglio con più clienti scoperti è quello di ${agentePrincipale[0]} (${agentePrincipale[1]}). ` : "") +
        `I primi per ordinato: ${senza.slice(0, 3).map((c) => `${c.cliente} ${euroTesto(c.ordinato12Mesi)}`).join("; ")}.`,
      magnitudineEuro: valore,
      persistenza: 0.9,
      azionabilita: 1,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { clienti: senza.slice(0, 25), totaleClienti: senza.length, valore },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 22 — Visite senza seguito
// Una visita aveva una «prossima visita» ormai passata e il cliente non e' piu'
// stato visitato. Senza euro propri: pesa il 10% dell'ordinato dei clienti.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaVisiteSenzaSeguito(ctx: ContestoRilevatori): Segnale[] {
  const visite = righeAgente(ctx, dataset(ctx, "visite"));
  if (visite.length === 0) return [];
  const piuRecente = new Map<string, string>();
  for (const r of visite) {
    const k = chiaveCliente(r);
    if (k && r.data > (piuRecente.get(k) ?? "")) piuRecente.set(k, r.data);
  }
  const dopo = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.seguitoGiorniMassimi);
  const entro = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.seguitoGiorniMinimi);

  const promessi = new Map<string, { cliente: string; agente: string; visita: string; prevista: string }>();
  for (const r of visite) {
    const k = chiaveCliente(r);
    if (!k || !r.prossimaVisita) continue;
    if (r.prossimaVisita < dopo || r.prossimaVisita > entro) continue;
    if ((piuRecente.get(k) ?? "") > r.data) continue; // c'e' stata una visita dopo
    const prec = promessi.get(k);
    if (!prec || r.data >= prec.visita) promessi.set(k, { cliente: r.cliente, agente: r.agente, visita: r.data, prevista: r.prossimaVisita });
  }
  if (promessi.size < SOGLIE_ESTESE.seguitoClientiMinimi) return [];

  const ordinato = ordinato12Mesi(ctx);
  const elenco = [...promessi.entries()]
    .map(([k, v]) => ({ ...v, ordinato12Mesi: arr(ordinato.get(k)?.valore ?? 0), giorniDiRitardo: giorniTra(v.prevista, ctx.oggi) }))
    .sort((a, b) => b.ordinato12Mesi - a.ordinato12Mesi);
  const valore = arr(elenco.reduce((t, c) => t + c.ordinato12Mesi, 0));
  const peso = arr(valore * SOGLIE_ESTESE.quotaPesoSenzaEuro);
  if (peso <= 0) return [];

  const perAgente = new Map<string, number>();
  for (const c of elenco) perAgente.set(c.agente, (perAgente.get(c.agente) ?? 0) + 1);
  const [agentePrincipale] = [...perAgente.entries()].sort((a, b) => b[1] - a[1]);

  return [
    {
      id: "visite-senza-seguito",
      famiglia: "visite_senza_seguito",
      titolo: `${elenco.length} clienti con la prossima visita saltata`,
      descrizione:
        `${elenco.length} clienti avevano una prossima visita fissata nelle ultime settimane e non sono stati più visitati; ` +
        `valgono ${euroTesto(valore)} di ordinato in 12 mesi. ` +
        (agentePrincipale ? `Ne ha di più ${agentePrincipale[0]} (${agentePrincipale[1]}). ` : "") +
        `Ritardi maggiori: ${[...elenco].sort((a, b) => b.giorniDiRitardo - a.giorniDiRitardo).slice(0, 3).map((c) => `${c.cliente} (${c.giorniDiRitardo} giorni)`).join("; ")}.`,
      magnitudineEuro: peso,
      persistenza: 0.6,
      azionabilita: 1,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { clienti: elenco.slice(0, 25), totaleClienti: elenco.length, ordinato12Mesi: valore, pesoComeQuota: SOGLIE_ESTESE.quotaPesoSenzaEuro },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 23 — Province con meno visite
// Ultimi 90 giorni contro la media dei 90 giorni dei 270 precedenti.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaVisiteInCalo(ctx: ContestoRilevatori): Segnale[] {
  const visite = righeAgente(ctx, dataset(ctx, "visite")).filter((r) => r.provincia && r.data && r.data <= ctx.oggi);
  if (visite.length === 0) return [];
  const inizioRecente = spostaGiorni(ctx.oggi, -90);
  const inizioBase = spostaGiorni(ctx.oggi, -360);

  const perProvincia = new Map<string, { recenti: number; base: number }>();
  const provinciaCliente = new Map<string, string>();
  for (const r of visite) {
    if (r.data <= inizioBase) continue;
    const p = perProvincia.get(r.provincia ?? "") ?? { recenti: 0, base: 0 };
    if (r.data > inizioRecente) p.recenti += 1;
    else p.base += 1;
    perProvincia.set(r.provincia ?? "", p);
    const k = chiaveCliente(r);
    if (k && r.provincia) provinciaCliente.set(k, r.provincia);
  }
  const ordinato = ordinato12Mesi(ctx);
  const valorePerProvincia = new Map<string, number>();
  for (const [k, c] of ordinato) {
    const p = provinciaCliente.get(k);
    if (p) valorePerProvincia.set(p, (valorePerProvincia.get(p) ?? 0) + c.valore);
  }

  const inCalo = [...perProvincia.entries()]
    .map(([provincia, p]) => ({ provincia, ora: p.recenti, mediaPrima: arr(p.base / 3), ordinato12Mesi: arr(valorePerProvincia.get(provincia) ?? 0) }))
    .filter((p) => p.mediaPrima >= SOGLIE_ESTESE.visiteProvinciaBaseMinima && p.ora <= p.mediaPrima * (1 - SOGLIE_ESTESE.visiteProvinciaCaloPct / 100))
    .sort((a, b) => b.ordinato12Mesi - a.ordinato12Mesi);
  if (inCalo.length === 0) return [];

  const valore = arr(inCalo.reduce((t, p) => t + p.ordinato12Mesi, 0));
  const peso = arr(valore * SOGLIE_ESTESE.quotaPesoSenzaEuro);
  if (peso <= 0) return [];
  const primi = inCalo.slice(0, 5);

  return [
    {
      id: "visite-in-calo",
      famiglia: "visite_in_calo",
      titolo: `Visite in calo in ${inCalo.length} province`,
      descrizione:
        `Negli ultimi 90 giorni le visite sono scese di almeno il ${SOGLIE_ESTESE.visiteProvinciaCaloPct}% rispetto alla media dei 270 giorni prima in ${inCalo.length} province: ` +
        primi.map((p) => `${p.provincia} ${p.mediaPrima} → ${p.ora} (clienti visitati: ${euroTesto(p.ordinato12Mesi)} di ordinato in 12 mesi)`).join("; ") +
        `. Il periodo include le chiusure estive.`,
      magnitudineEuro: peso,
      persistenza: 0.6,
      azionabilita: 0.6,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { province: primi, totaleProvince: inCalo.length, ordinato12Mesi: valore, pesoComeQuota: SOGLIE_ESTESE.quotaPesoSenzaEuro },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 24 — Preventivo presentato in visita e nessun ordine
// ─────────────────────────────────────────────────────────────────────────────

function rilevaPreventiviSenzaOrdine(ctx: ContestoRilevatori): Segnale[] {
  const visite = righeAgente(ctx, dataset(ctx, "visite")).filter((r) => /preventiv/i.test(r.tipoVisita ?? "") && r.data);
  if (visite.length === 0) return [];
  const dopo = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.preventivoVisitaGiorniMassimi);
  const entro = spostaGiorni(ctx.oggi, -SOGLIE_ESTESE.preventivoVisitaGiorniMinimi);

  const ultimaPerCliente = new Map<string, RigaFatto>();
  for (const r of visite) {
    const k = chiaveCliente(r);
    if (!k || r.data < dopo || r.data > entro) continue;
    const p = ultimaPerCliente.get(k);
    if (!p || r.data >= p.data) ultimaPerCliente.set(k, r);
  }
  if (ultimaPerCliente.size === 0) return [];

  const ultimoOrdine = new Map<string, string>();
  for (const r of righeAgente(ctx, dataset(ctx, "ordinato"))) {
    const k = chiaveCliente(r);
    if (k && r.data > (ultimoOrdine.get(k) ?? "")) ultimoOrdine.set(k, r.data);
  }
  const aperti = new Map<string, number>();
  for (const r of righeAgente(ctx, dataset(ctx, "preventivi_aperti")).filter(preventivoInCorso)) {
    const k = chiaveCliente(r);
    if (k) aperti.set(k, (aperti.get(k) ?? 0) + r.importo);
  }

  const elenco = [...ultimaPerCliente.entries()]
    .filter(([k, v]) => (ultimoOrdine.get(k) ?? "") <= v.data)
    .map(([k, v]) => ({ cliente: v.cliente, agente: v.agente, visita: v.data, giorni: giorniTra(v.data, ctx.oggi), preventiviAperti: arr(aperti.get(k) ?? 0) }))
    .filter((c) => c.preventiviAperti >= SOGLIE_ESTESE.preventivoVisitaClienteMinimoEuro)
    .sort((a, b) => b.preventiviAperti - a.preventiviAperti);
  const valore = arr(elenco.reduce((t, c) => t + c.preventiviAperti, 0));
  if (elenco.length === 0 || valore < SOGLIE_ESTESE.preventivoVisitaMinimoEuro) return [];

  return [
    {
      id: "preventivi-visita-senza-ordine",
      famiglia: "preventivi_senza_ordine",
      titolo: `${elenco.length} preventivi presentati in visita e ancora senza ordine`,
      descrizione:
        `${elenco.length} clienti hanno avuto una visita di presentazione preventivo tra ${SOGLIE_ESTESE.preventivoVisitaGiorniMinimi} e ${SOGLIE_ESTESE.preventivoVisitaGiorniMassimi} giorni fa, ` +
        `non hanno ordinato dopo e hanno ancora preventivi aperti per ${euroTesto(valore)}. ` +
        `I più pesanti: ${elenco.slice(0, 3).map((c) => `${c.cliente} ${euroTesto(c.preventiviAperti)} (visita di ${c.giorni} giorni fa)`).join("; ")}.`,
      magnitudineEuro: valore,
      persistenza: 0.7,
      azionabilita: 1,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { clienti: elenco.slice(0, 25), totaleClienti: elenco.length, valore },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 25 — Spese di trasporto in salita
// Euro per 100 kg sui documenti in uscita, ultimi 90 giorni contro i 12 mesi
// prima.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaTrasportoCosto(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const righe = dataset(ctx, "spedizioni").filter(
    (r) => r.direzioneMerce === "Merce in uscita" && (r.pesoLordo ?? 0) > 0 && (r.speseTrasporto ?? 0) > 0 && r.data && r.data <= ctx.oggi
  );
  if (righe.length === 0) return [];
  const inizioRecente = spostaGiorni(ctx.oggi, -90);
  const inizioBase = spostaGiorni(ctx.oggi, -455);
  const ora = { spese: 0, kg: 0 };
  const prima = { spese: 0, kg: 0 };
  for (const r of righe) {
    if (r.data <= inizioBase) continue;
    const f = r.data > inizioRecente ? ora : prima;
    f.spese += r.speseTrasporto ?? 0;
    f.kg += r.pesoLordo ?? 0;
  }
  if (ora.kg < SOGLIE_ESTESE.trasportoPesoRecenteMinimoKg || prima.kg <= 0) return [];
  const tariffaOra = (ora.spese / ora.kg) * 100;
  const tariffaPrima = (prima.spese / prima.kg) * 100;
  const scarto = pct(tariffaOra - tariffaPrima, tariffaPrima);
  const impatto = arr(((tariffaOra - tariffaPrima) / 100) * ora.kg);
  if (scarto < SOGLIE_ESTESE.trasportoScartoPct || impatto < SOGLIE_ESTESE.trasportoImpattoMinimoEuro) return [];

  return [
    {
      id: "trasporto-costo",
      famiglia: "trasporto_costo",
      titolo: `Spese di trasporto a ${arr(tariffaOra)} € ogni 100 kg: +${scarto}%`,
      descrizione:
        `Sui documenti di trasporto in uscita degli ultimi 90 giorni le spese addebitate sono ${arr(tariffaOra)} € ogni 100 kg di peso lordo, ` +
        `contro ${arr(tariffaPrima)} € dei 12 mesi precedenti (+${scarto}%). Su ${Math.round(ora.kg).toLocaleString("it-IT")} kg la differenza vale ${euroTesto(impatto)}.`,
      magnitudineEuro: impatto,
      persistenza: 0.6,
      azionabilita: 0.6,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { tariffaOra: arr(tariffaOra), tariffaPrima: arr(tariffaPrima), scarto, kgRecenti: Math.round(ora.kg), speseRecenti: arr(ora.spese) },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 26 — Un solo vettore per quasi tutte le spedizioni
// ─────────────────────────────────────────────────────────────────────────────

function rilevaVettoreConcentrato(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const da = spostaGiorni(ctx.oggi, -180);
  const righe = dataset(ctx, "spedizioni").filter(
    (r) => r.direzioneMerce === "Merce in uscita" && r.data > da && r.data <= ctx.oggi && r.vettore && r.vettore !== "(senza vettore)"
  );
  if (righe.length < SOGLIE_ESTESE.vettoreDocumentiMinimi) return [];
  const perVettore = new Map<string, { documenti: number; spese: number }>();
  for (const r of righe) {
    const v = perVettore.get(r.vettore ?? "") ?? { documenti: 0, spese: 0 };
    v.documenti += 1;
    v.spese += r.speseTrasporto ?? 0;
    perVettore.set(r.vettore ?? "", v);
  }
  const [primo] = [...perVettore.entries()].sort((a, b) => b[1].documenti - a[1].documenti);
  if (!primo) return [];
  const quota = pct(primo[1].documenti, righe.length);
  const spese = arr(primo[1].spese);
  if (quota < SOGLIE_ESTESE.vettoreQuotaPct || spese <= 0) return [];

  return [
    {
      id: "vettore-concentrato",
      famiglia: "vettore_concentrato",
      titolo: `Il ${quota}% delle spedizioni in uscita passa da ${primo[0]}`,
      descrizione:
        `Negli ultimi 180 giorni ${primo[1].documenti} dei ${righe.length} documenti di trasporto in uscita (${quota}%) sono con ${primo[0]}, ` +
        `con ${euroTesto(spese)} di spese addebitate. Se il vettore ha un fermo o cambia le tariffe, quasi tutta la spedizione ne risente.`,
      magnitudineEuro: spese,
      persistenza: 1,
      azionabilita: 0.4,
      direzione: "neutro",
      punteggio: 0,
      prove: [],
      dettaglio: { vettore: primo[0], quota, documenti: primo[1].documenti, totaleDocumenti: righe.length, spese },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 27 — Fatture fornitore senza ordine
// ─────────────────────────────────────────────────────────────────────────────

function rilevaFattureSenzaOrdine(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const da = spostaGiorni(ctx.oggi, -90);
  const righe = dataset(ctx, "fatture_fornitore").filter(
    (r) => PROFILI_FATTURA_FORNITORE.has(r.profilo ?? "") && r.importo > 0 && r.data > da && r.data <= ctx.oggi
  );
  if (righe.length === 0) return [];
  const totale = righe.reduce((t, r) => t + r.importo, 0);
  const senza = righe.filter((r) => !r.profiloOrdine);
  const valore = arr(senza.reduce((t, r) => t + r.importo, 0));
  const quota = pct(valore, totale);
  if (valore < SOGLIE_ESTESE.fattureSenzaOrdineMinimoEuro || quota < SOGLIE_ESTESE.fattureSenzaOrdineQuotaPct) return [];

  const perFornitore = new Map<string, { fornitore: string; valore: number }>();
  for (const r of senza) {
    const k = r.fornitore || r.soggetto || "(senza fornitore)";
    const f = perFornitore.get(k) ?? { fornitore: k, valore: 0 };
    f.valore += r.importo;
    perFornitore.set(k, f);
  }
  const primi = classifica(perFornitore, 5).map((f) => ({ fornitore: f.fornitore, valore: arr(f.valore) }));

  return [
    {
      id: "fatture-senza-ordine",
      famiglia: "fatture_senza_ordine",
      titolo: `${euroTesto(valore)} di fatture fornitore senza ordine collegato`,
      descrizione:
        `Negli ultimi 90 giorni il ${quota}% del valore fatturato dai fornitori (${euroTesto(valore)} su ${euroTesto(totale)}) ` +
        `è su righe che non puntano a nessun ordine. I primi: ${primi.slice(0, 3).map((f) => `${f.fornitore} ${euroTesto(f.valore)}`).join("; ")}. ` +
        `Possono essere servizi e spese che non passano da un ordine: da verificare, non per forza anomalie.`,
      magnitudineEuro: valore,
      persistenza: 0.6,
      azionabilita: 0.7,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { valore, totale: arr(totale), quota, fornitori: primi },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 28 — Dipendenza da un fornitore
// ─────────────────────────────────────────────────────────────────────────────

function rilevaDipendenzaFornitore(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const da = spostaGiorni(ctx.oggi, -365);
  const righe = dataset(ctx, "fatture_fornitore").filter(
    (r) => PROFILI_FATTURA_FORNITORE.has(r.profilo ?? "") && r.data > da && r.data <= ctx.oggi
  );
  const perFornitore = new Map<string, number>();
  let totale = 0;
  for (const r of righe) {
    const k = r.fornitore || r.soggetto || "(senza fornitore)";
    perFornitore.set(k, (perFornitore.get(k) ?? 0) + r.importo);
    totale += r.importo;
  }
  if (totale < SOGLIE_ESTESE.dipendenzaTotaleMinimoEuro) return [];
  const ordinati = [...perFornitore.entries()].sort((a, b) => b[1] - a[1]);
  const [primo, secondo] = ordinati;
  const quota = pct(primo[1], totale);
  if (quota < SOGLIE_ESTESE.dipendenzaQuotaPct) return [];

  return [
    {
      id: "dipendenza-fornitore",
      famiglia: "dipendenza_fornitore",
      titolo: `Il ${quota}% degli acquisti fatturati è di ${primo[0]}`,
      descrizione:
        `Nelle fatture fornitore degli ultimi 12 mesi ${primo[0]} pesa ${euroTesto(primo[1])} su ${euroTesto(totale)} (${quota}%)` +
        (secondo ? `; il secondo, ${secondo[0]}, ${euroTesto(secondo[1])} (${pct(secondo[1], totale)}%)` : "") +
        ".",
      magnitudineEuro: arr(primo[1]),
      persistenza: 1,
      azionabilita: 0.4,
      direzione: "neutro",
      punteggio: 0,
      prove: [],
      dettaglio: { fornitore: primo[0], valore: arr(primo[1]), totale: arr(totale), quota },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 29 — Clienti che ordinano senza un agente
// ─────────────────────────────────────────────────────────────────────────────

function rilevaClientiSenzaAgente(ctx: ContestoRilevatori): Segnale[] {
  if (ctx.agente) return [];
  const senzaAgente = (a: string) => !a || /senza agente|non assegnat/i.test(a);
  const da = spostaGiorni(ctx.oggi, -365);
  const perCliente = new Map<string, { cliente: string; valore: number }>();
  for (const r of dataset(ctx, "ordinato")) {
    if (!senzaAgente(r.agente) || !r.data || r.data <= da || r.data > ctx.oggi) continue;
    const k = chiaveCliente(r);
    if (!k) continue;
    const c = perCliente.get(k) ?? { cliente: r.cliente, valore: 0 };
    c.valore += r.importo;
    perCliente.set(k, c);
  }
  const valore = arr([...perCliente.values()].reduce((t, c) => t + c.valore, 0));
  if (perCliente.size < SOGLIE_ESTESE.senzaAgenteClientiMinimi || valore < SOGLIE_ESTESE.senzaAgenteMinimoEuro) return [];
  const primi = classifica(perCliente, 5).map((c) => ({ cliente: c.cliente, valore: arr(c.valore) }));

  return [
    {
      id: "clienti-senza-agente",
      famiglia: "clienti_senza_agente",
      titolo: `${perCliente.size} clienti che ordinano non hanno un agente`,
      descrizione:
        `${perCliente.size} clienti senza agente assegnato hanno ordinato ${euroTesto(valore)} negli ultimi 12 mesi, ` +
        `e nessun portafoglio li segue. I primi: ${primi.slice(0, 3).map((c) => `${c.cliente} ${euroTesto(c.valore)}`).join("; ")}.`,
      magnitudineEuro: valore,
      persistenza: 1,
      azionabilita: 0.9,
      direzione: "negativo",
      punteggio: 0,
      prove: [],
      dettaglio: { clienti: primi, totaleClienti: perCliente.size, valore },
    },
  ];
}

/** I rilevatori di questo file, nell'ordine in cui `rilevaTutto` li esegue. */
export const RILEVATORI_ESTESI: Array<(ctx: ContestoRilevatori) => Segnale[]> = [
  rilevaIncassiScaduti,
  rilevaPagamentiFornitori,
  rilevaCassaProssimi30,
  rilevaClientiPaganoTardi,
  rilevaArticoliScoperti,
  rilevaGiacenzaFerma,
  rilevaRincariRecenti,
  rilevaClientiSenzaVisite,
  rilevaVisiteSenzaSeguito,
  rilevaVisiteInCalo,
  rilevaPreventiviSenzaOrdine,
  rilevaTrasportoCosto,
  rilevaVettoreConcentrato,
  rilevaFattureSenzaOrdine,
  rilevaDipendenzaFornitore,
  rilevaClientiSenzaAgente,
];
