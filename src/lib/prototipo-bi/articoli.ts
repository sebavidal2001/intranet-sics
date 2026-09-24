
import { createAdminClient } from "@/lib/supabase/admin";

type Riga = Record<string, unknown>;

export interface FiltriArticoli {
  cerca?: string;
  categoria?: string;
  fornitore?: string;
  magazzino?: string;
  soloCritici?: boolean;
}

export interface ArticoloAcquisti {
  codice: string;
  descrizione: string;
  categoria: string;
  gruppo: string;
  fornitore: string;
  costo: number | null;
  dataCosto: string | null;
  costoStale: boolean;
  esistenza: number;
  disponibilita: number;
  ordiniClienti: number;
  ordiniFornitori: number;
  impegniProduzione: number;
  ordiniProduzione: number;
  scoperto: number;
  valoreScoperto: number | null;
  valoreGiacenza: number | null;
  valoreInArrivo: number | null;
}

export interface CruscottoArticoli {
  aggiornatoIl: string | null;
  riepilogo: {
    articoli: number;
    articoliCritici: number;
    fornitori: number;
    valoreGiacenza: number;
    valoreInArrivo: number;
    valoreScoperto: number;
    quantitaScoperta: number;
    coperturaCostiPct: number;
    costiMancanti: number;
    costiObsoleti: number;
    fornitoriMancanti: number;
  };
  filtri: {
    categorie: string[];
    fornitori: string[];
    magazzini: string[];
  };
  urgenze: ArticoloAcquisti[];
  fornitori: Array<{ nome: string; valoreInArrivo: number; valoreScoperto: number; articoli: number }>;
  categorie: Array<{ nome: string; valoreGiacenza: number; valoreScoperto: number; articoliCritici: number }>;
  magazzini: Array<{ nome: string; esistenza: number; disponibilita: number; ordiniFornitori: number }>;
}

interface CacheArticoli {
  prodotti: Riga[];
  giacenze: Riga[];
  caricatoIl: number;
}

let cache: CacheArticoli | null = null;
const CACHE_MS = 10 * 60 * 1000;
const PAGINA = 1000;

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function testo(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  return s || fallback;
}

interface ErrorePostgrest {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Il messaggio di un errore PostgREST puo' essere VUOTO: e' cio' che finiva nel
 * log come "Conteggio prodotti:" e basta, nove volte, senza nessun indizio. Si
 * compone quel che c'e', e in ultima istanza lo stato HTTP.
 */
export function descriviErrore(errore: ErrorePostgrest | null, stato?: number): string {
  const parti = [errore?.message, errore?.code, errore?.details, errore?.hint]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  if (stato) parti.push(`HTTP ${stato}`);
  return parti.length > 0 ? parti.join(" · ") : "errore senza descrizione";
}

const TENTATIVI = 3;

/**
 * Riprova le letture che falliscono per un momento: durante l'ingest notturno
 * del Cruscotto le tabelle `prodotti` e `prodotti_giacenze` vengono riscritte,
 * e una richiesta che cade in quella finestra non dice niente dei dati.
 */
async function conRiprova<T extends { error: ErrorePostgrest | null; status?: number }>(
  descrizione: string,
  richiesta: () => PromiseLike<T>
): Promise<T> {
  let ultimo = "";
  for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
    const esito = await richiesta();
    if (!esito.error) return esito;
    ultimo = descriviErrore(esito.error, esito.status);
    if (tentativo < TENTATIVI) await new Promise((r) => setTimeout(r, 500 * tentativo));
  }
  throw new Error(`${descrizione}: ${ultimo} (dopo ${TENTATIVI} tentativi)`);
}

async function scaricaPaginato(tabella: string, campi: string): Promise<Riga[]> {
  const sb = createAdminClient().schema("preventivatore");
  const intervallo = (pagina: number) => [pagina * PAGINA, pagina * PAGINA + PAGINA - 1] as const;

  // Il conteggio viaggia con la PRIMA PAGINA, non con una richiesta HEAD a
  // parte: una HEAD non ha corpo, quindi quando fallisce l'errore arriva senza
  // messaggio. E si risparmia un giro.
  const prima = await conRiprova(`Lettura ${tabella} pagina 0`, () =>
    sb.from(tabella).select(campi, { count: "exact" }).range(...intervallo(0))
  );
  const totale = prima.count ?? 0;
  const blocchi: Riga[][] = [(prima.data ?? []) as unknown as Riga[]];

  const pagine = Math.ceil(totale / PAGINA);
  for (let base = 1; base < pagine; base += 6) {
    const lotto = await Promise.all(
      Array.from({ length: Math.min(6, pagine - base) }, (_, offset) => {
        const pagina = base + offset;
        return conRiprova(`Lettura ${tabella} pagina ${pagina}`, () =>
          sb.from(tabella).select(campi).range(...intervallo(pagina))
        );
      })
    );
    for (const esito of lotto) blocchi.push((esito.data ?? []) as unknown as Riga[]);
  }
  return blocchi.flat();
}

async function caricaBase(): Promise<CacheArticoli> {
  if (cache && Date.now() - cache.caricatoIl < CACHE_MS) return cache;
  try {
    const [prodotti, giacenze] = await Promise.all([
      scaricaPaginato(
        "prodotti",
        "codice,descrizione,categoria,gruppo,fornitore,ult_costo,data_ult_costo,attivo,aggiornato_il"
      ),
      scaricaPaginato(
        "prodotti_giacenze",
        "codice,magazzino,esistenza,disponibilita,qta_ord_clienti,qta_ord_fornitori,qta_imp_produzione,qta_ord_produzione,aggiornato_il"
      ),
    ]);
    cache = { prodotti, giacenze, caricatoIl: Date.now() };
    return cache;
  } catch (e) {
    // Meglio i dati di qualche minuto fa di una pagina d'errore: la data di
    // aggiornamento mostrata in pagina viene dalle righe, quindi resta vera.
    if (cache) {
      console.warn("[prototipo-bi.articoli] rilettura fallita, servo la copia precedente:", e instanceof Error ? e.message : e);
      return cache;
    }
    throw e;
  }
}

export async function ottieniCruscottoArticoli(
  filtri: FiltriArticoli = {}
): Promise<CruscottoArticoli> {
  const base = await caricaBase();
  const magazziniDisponibili = [...new Set(base.giacenze.map((g) => testo(g.magazzino)).filter(Boolean))].sort();
  const giacenzeFiltrate = filtri.magazzino
    ? base.giacenze.filter((g) => testo(g.magazzino) === filtri.magazzino)
    : base.giacenze;

  const perCodice = new Map<string, Riga[]>();
  for (const g of giacenzeFiltrate) {
    const codice = testo(g.codice);
    perCodice.set(codice, [...(perCodice.get(codice) ?? []), g]);
  }

  const dateAggiornamento = [...base.prodotti, ...base.giacenze]
    .map((r) => testo(r.aggiornato_il))
    .filter(Boolean)
    .sort();
  const aggiornatoIl = dateAggiornamento.at(-1) ?? null;
  const riferimento = aggiornatoIl ? new Date(aggiornatoIl) : new Date();
  const sogliaCosto = new Date(riferimento);
  sogliaCosto.setUTCFullYear(sogliaCosto.getUTCFullYear() - 1);

  const tutti = base.prodotti
    .filter((p) => p.attivo !== false)
    .map<ArticoloAcquisti>((p) => {
      const codice = testo(p.codice);
      const righe = perCodice.get(codice) ?? [];
      const costoRaw = p.ult_costo;
      const costo = costoRaw === null || costoRaw === undefined || costoRaw === "" ? null : numero(costoRaw);
      const dataCosto = testo(p.data_ult_costo) || null;
      const esistenza = righe.reduce((s, g) => s + numero(g.esistenza), 0);
      const disponibilita = righe.reduce((s, g) => s + numero(g.disponibilita), 0);
      const ordiniClienti = righe.reduce((s, g) => s + numero(g.qta_ord_clienti), 0);
      const ordiniFornitori = righe.reduce((s, g) => s + numero(g.qta_ord_fornitori), 0);
      const impegniProduzione = righe.reduce((s, g) => s + numero(g.qta_imp_produzione), 0);
      const ordiniProduzione = righe.reduce((s, g) => s + numero(g.qta_ord_produzione), 0);
      const scoperto = Math.max(0, -disponibilita);
      return {
        codice,
        descrizione: testo(p.descrizione, "Senza descrizione"),
        categoria: testo(p.categoria, "(non assegnata)"),
        gruppo: testo(p.gruppo, "(non assegnato)"),
        fornitore: testo(p.fornitore, "(non assegnato)"),
        costo,
        dataCosto,
        costoStale: !dataCosto || new Date(dataCosto) < sogliaCosto,
        esistenza,
        disponibilita,
        ordiniClienti,
        ordiniFornitori,
        impegniProduzione,
        ordiniProduzione,
        scoperto,
        valoreScoperto: costo === null ? null : scoperto * costo,
        valoreGiacenza: costo === null ? null : Math.max(0, esistenza) * costo,
        valoreInArrivo: costo === null ? null : Math.max(0, ordiniFornitori) * costo,
      };
    });

  const categorie = [...new Set(tutti.map((a) => a.categoria))].sort();
  const fornitori = [...new Set(tutti.map((a) => a.fornitore))].sort();
  const cerca = filtri.cerca?.trim().toLocaleLowerCase("it") ?? "";
  let articoli = tutti.filter((a) => {
    if (filtri.categoria && a.categoria !== filtri.categoria) return false;
    if (filtri.fornitore && a.fornitore !== filtri.fornitore) return false;
    if (cerca && !`${a.codice} ${a.descrizione} ${a.fornitore}`.toLocaleLowerCase("it").includes(cerca)) return false;
    if (filtri.soloCritici && a.scoperto <= 0) return false;
    return true;
  });

  const critici = articoli.filter((a) => a.scoperto > 0);
  const conCosto = articoli.filter((a) => a.costo !== null && a.costo > 0);

  const perFornitore = new Map<string, { valoreInArrivo: number; valoreScoperto: number; articoli: Set<string> }>();
  const perCategoria = new Map<string, { valoreGiacenza: number; valoreScoperto: number; critici: Set<string> }>();
  for (const a of articoli) {
    const f = perFornitore.get(a.fornitore) ?? { valoreInArrivo: 0, valoreScoperto: 0, articoli: new Set<string>() };
    f.valoreInArrivo += a.valoreInArrivo ?? 0;
    f.valoreScoperto += a.valoreScoperto ?? 0;
    if (a.ordiniFornitori > 0 || a.scoperto > 0) f.articoli.add(a.codice);
    perFornitore.set(a.fornitore, f);

    const c = perCategoria.get(a.categoria) ?? { valoreGiacenza: 0, valoreScoperto: 0, critici: new Set<string>() };
    c.valoreGiacenza += a.valoreGiacenza ?? 0;
    c.valoreScoperto += a.valoreScoperto ?? 0;
    if (a.scoperto > 0) c.critici.add(a.codice);
    perCategoria.set(a.categoria, c);
  }

  const perMagazzino = new Map<string, { esistenza: number; disponibilita: number; ordiniFornitori: number }>();
  for (const g of giacenzeFiltrate) {
    const nome = testo(g.magazzino, "(non assegnato)");
    const m = perMagazzino.get(nome) ?? { esistenza: 0, disponibilita: 0, ordiniFornitori: 0 };
    m.esistenza += numero(g.esistenza);
    m.disponibilita += numero(g.disponibilita);
    m.ordiniFornitori += numero(g.qta_ord_fornitori);
    perMagazzino.set(nome, m);
  }

  articoli = articoli.sort((a, b) => {
    const valoreA = a.valoreScoperto ?? a.scoperto;
    const valoreB = b.valoreScoperto ?? b.scoperto;
    if (valoreB !== valoreA) return valoreB - valoreA;
    return b.ordiniClienti - a.ordiniClienti;
  });

  return {
    aggiornatoIl,
    riepilogo: {
      articoli: articoli.length,
      articoliCritici: critici.length,
      fornitori: new Set(articoli.map((a) => a.fornitore).filter((f) => f !== "(non assegnato)")).size,
      valoreGiacenza: articoli.reduce((s, a) => s + (a.valoreGiacenza ?? 0), 0),
      valoreInArrivo: articoli.reduce((s, a) => s + (a.valoreInArrivo ?? 0), 0),
      valoreScoperto: articoli.reduce((s, a) => s + (a.valoreScoperto ?? 0), 0),
      quantitaScoperta: critici.reduce((s, a) => s + a.scoperto, 0),
      coperturaCostiPct: articoli.length ? (conCosto.length / articoli.length) * 100 : 0,
      costiMancanti: articoli.filter((a) => a.costo === null || a.costo <= 0).length,
      costiObsoleti: articoli.filter((a) => a.costo !== null && a.costoStale).length,
      fornitoriMancanti: articoli.filter((a) => a.fornitore === "(non assegnato)").length,
    },
    filtri: { categorie, fornitori, magazzini: magazziniDisponibili },
    urgenze: articoli.filter((a) => a.scoperto > 0 || a.ordiniClienti > 0).slice(0, 80),
    fornitori: [...perFornitore.entries()]
      .map(([nome, v]) => ({ nome, valoreInArrivo: v.valoreInArrivo, valoreScoperto: v.valoreScoperto, articoli: v.articoli.size }))
      .filter((x) => x.valoreInArrivo > 0 || x.valoreScoperto > 0)
      .sort((a, b) => b.valoreInArrivo + b.valoreScoperto - (a.valoreInArrivo + a.valoreScoperto))
      .slice(0, 12),
    categorie: [...perCategoria.entries()]
      .map(([nome, v]) => ({ nome, valoreGiacenza: v.valoreGiacenza, valoreScoperto: v.valoreScoperto, articoliCritici: v.critici.size }))
      .sort((a, b) => b.valoreScoperto - a.valoreScoperto || b.valoreGiacenza - a.valoreGiacenza)
      .slice(0, 12),
    magazzini: [...perMagazzino.entries()]
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.ordiniFornitori - a.ordiniFornitori),
  };
}

export function invalidaCacheArticoli() {
  cache = null;
}
