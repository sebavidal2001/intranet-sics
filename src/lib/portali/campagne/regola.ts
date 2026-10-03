/**
 * La regola del pubblico standard, in TypeScript.
 *
 * E' la STESSA regola di `campagne.pubblico_standard_codici()` (migration 133):
 * serve alla pagina per mostrare subito, mentre si sceglie, a quanti clienti
 * arriverebbe, senza salvare e senza interrogare il server a ogni clic. Dopo il
 * salvataggio il server restituisce il suo conteggio: se i due non coincidessero
 * la pagina lo direbbe, invece di fidarsi in silenzio.
 *
 * Un cliente rientra se NON e' un rivenditore e (e' stato scelto a mano, oppure
 * il suo agente e' fra quelli «tutti», la sua categoria commerciale e' fra quelle
 * scelte e — se se ne e' scelta almeno una — la sua categoria di attivita' e' fra
 * quelle scelte). I clienti scelti a mano non sono toccati dal filtro per attivita'.
 */
export interface ClientePubblico {
  codice_cliente: string;
  ragione_sociale: string;
  agente_nome: string | null;
  cat_commerciale: string | null;
  cat_attivita: string | null;
}

export interface RegolaPubblico {
  /** Agenti presi con TUTTI i loro clienti (che rientrano nei filtri). */
  agenti: string[];
  categorie_commerciali: string[];
  /** Vuoto = tutte le categorie di attivita'. */
  categorie_attivita: string[];
  /** Clienti scelti a mano, fuori dai filtri. */
  clienti_extra: string[];
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

export function appartieneAlPubblico(c: ClientePubblico, r: RegolaPubblico): boolean {
  if (r.clienti_extra.includes(c.codice_cliente)) return true;
  if (!r.agenti.some((a) => norm(a) === norm(c.agente_nome))) return false;
  if (!r.categorie_commerciali.some((k) => norm(k) === norm(c.cat_commerciale))) return false;
  if (r.categorie_attivita.length === 0) return true;
  return r.categorie_attivita.some((t) => norm(t) === norm(c.cat_attivita));
}

export function contaPubblico(clienti: ClientePubblico[], r: RegolaPubblico): number {
  let n = 0;
  for (const c of clienti) if (appartieneAlPubblico(c, r)) n++;
  return n;
}

// ─── Agenti ────────────────────────────────────────────────────────────────
export type ModoAgente = "tutti" | "scelti" | "nessuno";

export const SENZA_AGENTE = "(senza agente)";

export interface GruppoAgente {
  agente: string;
  clienti: ClientePubblico[];
}

/** I clienti raggruppati per agente: i piu' numerosi per primi, «senza agente» in fondo. */
export function raggruppaPerAgente(clienti: ClientePubblico[]): GruppoAgente[] {
  const per = new Map<string, ClientePubblico[]>();
  for (const c of clienti) {
    const k = c.agente_nome?.trim() || SENZA_AGENTE;
    per.set(k, [...(per.get(k) ?? []), c]);
  }
  return [...per.entries()]
    .map(([agente, lista]) => ({ agente, clienti: lista.sort((a, b) => a.ragione_sociale.localeCompare(b.ragione_sociale)) }))
    .sort((a, b) => (a.agente === SENZA_AGENTE ? 1 : b.agente === SENZA_AGENTE ? -1 : b.clienti.length - a.clienti.length || a.agente.localeCompare(b.agente)));
}

/** Come e' impostato un agente, dalla regola. */
export function modoAgente(agente: string, r: RegolaPubblico, clientiDellAgente: ClientePubblico[]): ModoAgente {
  if (r.agenti.some((a) => norm(a) === norm(agente))) return "tutti";
  return clientiDellAgente.some((c) => r.clienti_extra.includes(c.codice_cliente)) ? "scelti" : "nessuno";
}

// ─── Categorie di attivita' ────────────────────────────────────────────────
/**
 * Le famiglie in cui Impresa raggruppa le categorie di attivita'. Il nome esteso e'
 * lo scioglimento dell'abbreviazione che compare nel dato; il codice resta sempre
 * visibile accanto, cosi' niente e' nascosto. Una famiglia sconosciuta si mostra col
 * suo codice, senza inventare un nome.
 */
const NOMI_FAMIGLIA: Record<string, string> = {
  "COSTR.": "Costruttori",
  "UT.FIN.": "Utilizzatori finali",
  "IMP.": "Impiantisti",
  "RIP.": "Riparatori",
  "ALLEST.": "Allestitori",
  "ST.TECN.": "Studi tecnici",
  VARIEE: "Varie (enti, scuole, privati, edilizia)",
};

export const SENZA_CATEGORIA = "(senza categoria)";

/** La famiglia di una categoria: il testo prima del primo spazio o trattino (`COSTR.` da `COSTR. macch.automatiche`). */
export function famigliaCategoria(cat: string | null | undefined): string {
  const t = (cat ?? "").trim();
  if (t === "" || t === "-") return SENZA_CATEGORIA;
  const m = /^[^\s-]+/.exec(t);
  return m ? m[0] : t;
}

export function nomeFamiglia(famiglia: string): string {
  return NOMI_FAMIGLIA[famiglia] ?? famiglia;
}

export interface VoceCategoria {
  categoria: string;
  clienti: number;
}

export interface FamigliaCategorie {
  famiglia: string;
  nome: string;
  clienti: number;
  categorie: VoceCategoria[];
}

/** Le categorie di attivita' dei clienti, raggruppate per famiglia, con i conteggi. */
export function raggruppaCategorie(clienti: ClientePubblico[]): FamigliaCategorie[] {
  const conteggi = new Map<string, number>();
  for (const c of clienti) {
    const k = (c.cat_attivita ?? "").trim() || SENZA_CATEGORIA;
    conteggi.set(k, (conteggi.get(k) ?? 0) + 1);
  }
  const per = new Map<string, VoceCategoria[]>();
  for (const [categoria, n] of conteggi) {
    const f = famigliaCategoria(categoria === SENZA_CATEGORIA ? null : categoria);
    per.set(f, [...(per.get(f) ?? []), { categoria, clienti: n }]);
  }
  return [...per.entries()]
    .map(([famiglia, voci]) => ({
      famiglia,
      nome: nomeFamiglia(famiglia),
      clienti: voci.reduce((s, v) => s + v.clienti, 0),
      categorie: voci.sort((a, b) => b.clienti - a.clienti || a.categoria.localeCompare(b.categoria)),
    }))
    .sort((a, b) => (a.famiglia === SENZA_CATEGORIA ? 1 : b.famiglia === SENZA_CATEGORIA ? -1 : b.clienti - a.clienti));
}
