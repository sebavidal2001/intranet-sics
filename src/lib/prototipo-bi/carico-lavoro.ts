/**
 * Carico di lavoro delle persone, da `documenti_utente` (migration 151).
 *
 * Una riga della fonte e' un DOCUMENTO con l'utente del gestionale che l'ha
 * creato, il giorno e l'ora di creazione e il numero di righe. Copre tutta la
 * catena — preventivi, ordini, bolle, fatture, dei clienti e dei fornitori —
 * e non soltanto i preventivi che il BI conosceva prima.
 *
 * Qui non si interroga niente: si trasformano i risultati delle SpecQuery in
 * cio' che la vista mostra, cosi' le regole (chi e' una persona e chi un
 * ruolo, come si contano i giorni lavorati) si provano senza rendere nulla.
 *
 * Due avvertenze che la vista deve far arrivare a chi legge:
 *  · «vendite», «segreteria», «amministrazione», «acquisti», «magazzino1/2»
 *    sono utenti CONDIVISI: ruoli, non persone. Si mostrano, ma separati dalle
 *    persone e fuori dai conteggi "persone attive" e "righe per giorno".
 *  · Le righe di un documento non sono tutte lo stesso sforzo: il numero di
 *    righe e' la misura del lavoro di inserimento, non della sua difficolta'.
 */

import type { RisultatoQuery } from "./tipi";

export type AreaLavoro = "vendite" | "acquisti";

export interface GruppoDocumenti {
  chiave: string;
  etichetta: string;
  profili: string[];
}

export interface DefinizioneArea {
  area: AreaLavoro;
  etichetta: string;
  metricaDocumenti: "documenti_vendita_creati" | "documenti_acquisto_creati";
  metricaRighe: "righe_vendita_inserite" | "righe_acquisto_inserite";
  gruppi: GruppoDocumenti[];
}

export const AREE_LAVORO: Record<AreaLavoro, DefinizioneArea> = {
  vendite: {
    area: "vendite",
    etichetta: "Vendite",
    metricaDocumenti: "documenti_vendita_creati",
    metricaRighe: "righe_vendita_inserite",
    gruppi: [
      { chiave: "preventivi", etichetta: "Preventivi", profili: ["PC", "PCA"] },
      { chiave: "ordini", etichetta: "Ordini", profili: ["OC", "OCB", "OCINT", "OCT"] },
      { chiave: "bolle", etichetta: "Bolle", profili: ["BC"] },
      { chiave: "fatture", etichetta: "Fatture", profili: ["FC", "FCA", "FCT", "NAC"] },
    ],
  },
  acquisti: {
    area: "acquisti",
    etichetta: "Acquisti",
    metricaDocumenti: "documenti_acquisto_creati",
    metricaRighe: "righe_acquisto_inserite",
    gruppi: [
      { chiave: "ordini", etichetta: "Ordini a fornitore", profili: ["OF", "OFT", "OFR"] },
      { chiave: "ddt", etichetta: "DDT d'acquisto", profili: ["BF"] },
      { chiave: "fatture", etichetta: "Fatture fornitore", profili: ["FF", "FFCEE", "NAF", "NAFCEE"] },
    ],
  },
};

export function gruppoDiProfilo(def: DefinizioneArea, profilo: string): GruppoDocumenti | undefined {
  return def.gruppi.find((g) => g.profili.includes(profilo));
}

// ─────────────────────────────────────────────────────────────────────────────
// Nomi e ruoli
// ─────────────────────────────────────────────────────────────────────────────

/** Stessa persona anche se scritta in modo diverso nelle fonti. */
export function chiavePersona(nome: string): string {
  return nome.normalize("NFKD").replace(/\s+/g, " ").trim().toUpperCase();
}

/** "LUCIA RODA" → "Lucia Roda"; un nome gia' misto resta com'e'. */
export function nomeLeggibile(nome: string): string {
  if (nome !== nome.toUpperCase()) return nome;
  return nome.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
}

const RUOLO_CONDIVISO = /^(vendite|segreteria|amministrazione|acquisti|magazzino\s*\d*)$/i;

/** Un utente condiviso e' un ufficio, non una persona. */
export function eRuoloCondiviso(nome: string): boolean {
  return RUOLO_CONDIVISO.test(nome.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Dai risultati alla vista
// ─────────────────────────────────────────────────────────────────────────────

export interface RisultatiCarico {
  documentiPerPersona?: RisultatoQuery;
  righePerPersona?: RisultatoQuery;
  /** Documenti per persona e profilo. */
  documentiPerProfilo?: RisultatoQuery;
  /** Documenti per persona e giorno: servono a contare i giorni lavorati. */
  documentiPerGiorno?: RisultatoQuery;
  /** Righe per persona e ora di creazione. */
  righePerOra?: RisultatoQuery;
}

export interface PersonaCarico {
  chiave: string;
  nome: string;
  condiviso: boolean;
  documenti: number;
  righe: number;
  righePerDocumento: number;
  giorniAttivi: number;
  righePerGiornoAttivo: number;
  /** Quota delle righe di tutta l'area. */
  quotaPct: number;
  /** Documenti per gruppo (preventivi, ordini, bolle…). */
  perGruppo: Record<string, number>;
}

function arr(n: number, decimali = 1): number {
  const f = 10 ** decimali;
  return Math.round(n * f) / f;
}

/**
 * Una riga per utente, ordinata per righe inserite. Gli utenti condivisi ci
 * sono, ma `condiviso` li distingue: la vista li separa dalle persone.
 */
export function costruisciPersone(def: DefinizioneArea, r: RisultatiCarico): PersonaCarico[] {
  const m = new Map<string, PersonaCarico>();
  const prendi = (nome: string): PersonaCarico => {
    const k = chiavePersona(nome);
    let p = m.get(k);
    if (!p) {
      p = {
        chiave: k,
        nome: nomeLeggibile(nome),
        condiviso: eRuoloCondiviso(nome),
        documenti: 0,
        righe: 0,
        righePerDocumento: 0,
        giorniAttivi: 0,
        righePerGiornoAttivo: 0,
        quotaPct: 0,
        perGruppo: Object.fromEntries(def.gruppi.map((g) => [g.chiave, 0])),
      };
      m.set(k, p);
    }
    return p;
  };

  for (const x of r.documentiPerPersona?.righe ?? []) {
    const nome = x.chiavi.creatore;
    if (nome) prendi(nome).documenti += x.valore;
  }
  for (const x of r.righePerPersona?.righe ?? []) {
    const nome = x.chiavi.creatore;
    if (nome) prendi(nome).righe += x.valore;
  }
  for (const x of r.documentiPerProfilo?.righe ?? []) {
    const nome = x.chiavi.creatore;
    const gruppo = gruppoDiProfilo(def, x.chiavi.profilo ?? "");
    if (nome && gruppo) prendi(nome).perGruppo[gruppo.chiave] += x.valore;
  }
  // I giorni lavorati: quanti giorni distinti ha creato almeno un documento.
  const giorni = new Map<string, Set<string>>();
  for (const x of r.documentiPerGiorno?.righe ?? []) {
    const nome = x.chiavi.creatore;
    const giorno = x.chiavi.periodo;
    if (!nome || !giorno || x.valore <= 0) continue;
    const k = chiavePersona(nome);
    const s = giorni.get(k) ?? new Set<string>();
    s.add(giorno);
    giorni.set(k, s);
  }

  const persone = [...m.values()];
  const totaleRighe = persone.reduce((t, p) => t + p.righe, 0);
  for (const p of persone) {
    p.giorniAttivi = giorni.get(p.chiave)?.size ?? 0;
    p.righePerDocumento = p.documenti > 0 ? arr(p.righe / p.documenti) : 0;
    p.righePerGiornoAttivo = p.giorniAttivi > 0 ? arr(p.righe / p.giorniAttivi) : 0;
    p.quotaPct = totaleRighe > 0 ? arr((100 * p.righe) / totaleRighe) : 0;
  }
  return persone
    .filter((p) => p.documenti > 0 || p.righe > 0)
    .sort((a, b) => b.righe - a.righe || b.documenti - a.documenti);
}

export interface SintesiCarico {
  documenti: number;
  righe: number;
  personeAttive: number;
  /** Righe per giorno lavorato, solo sulle persone (non sui ruoli condivisi). */
  righePerGiornoAttivo: number;
  righePerDocumento: number;
  /** Quota delle righe inserita da utenti condivisi: non e' attribuibile a nessuno. */
  quotaCondivisaPct: number;
}

export function sintetizza(persone: PersonaCarico[]): SintesiCarico {
  const documenti = persone.reduce((t, p) => t + p.documenti, 0);
  const righe = persone.reduce((t, p) => t + p.righe, 0);
  const reali = persone.filter((p) => !p.condiviso);
  const righeReali = reali.reduce((t, p) => t + p.righe, 0);
  const giorniReali = reali.reduce((t, p) => t + p.giorniAttivi, 0);
  return {
    documenti,
    righe,
    personeAttive: reali.length,
    righePerGiornoAttivo: giorniReali > 0 ? arr(righeReali / giorniReali) : 0,
    righePerDocumento: documenti > 0 ? arr(righe / documenti) : 0,
    quotaCondivisaPct: righe > 0 ? arr((100 * (righe - righeReali)) / righe) : 0,
  };
}

const GIORNI_SETTIMANA = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

/** Documenti per giorno della settimana, lunedi' per primo. */
export function perGiornoSettimana(giorniTotali: RisultatoQuery | undefined): { etichetta: string; valore: number }[] {
  const tot = new Array<number>(7).fill(0);
  for (const x of giorniTotali?.righe ?? []) {
    const g = x.chiavi.periodo;
    if (!g || !/^\d{4}-\d{2}-\d{2}$/.test(g)) continue;
    const idx = (new Date(`${g}T00:00:00Z`).getUTCDay() + 6) % 7;
    tot[idx] += x.valore;
  }
  return GIORNI_SETTIMANA.map((etichetta, i) => ({ etichetta, valore: tot[i] }));
}

/** Righe per ora del giorno (08:00…), sommate su tutte le persone. */
export function perOra(righePerOra: RisultatoQuery | undefined): { etichetta: string; valore: number }[] {
  const tot = new Map<string, number>();
  for (const x of righePerOra?.righe ?? []) {
    const ora = x.chiavi.ora_creazione;
    if (!ora || !/^\d{2}:00$/.test(ora)) continue;
    tot.set(ora, (tot.get(ora) ?? 0) + x.valore);
  }
  const ore = [...tot.keys()].sort();
  if (ore.length === 0) return [];
  // Tutte le ore fra la prima e l'ultima, anche quelle vuote: una pausa pranzo
  // sparita dal grafico lo fa sembrare un turno continuo.
  const da = Number(ore[0].slice(0, 2));
  const a = Number(ore[ore.length - 1].slice(0, 2));
  const out: { etichetta: string; valore: number }[] = [];
  for (let h = da; h <= a; h++) {
    const e = `${String(h).padStart(2, "0")}:00`;
    out.push({ etichetta: e, valore: tot.get(e) ?? 0 });
  }
  return out;
}

/** Persona × ora, per la mappa di calore: solo le prime `limite` per righe. */
export function mappaOre(
  righePerOra: RisultatoQuery | undefined,
  persone: PersonaCarico[],
  limite = 10
): { righe: string[]; colonne: string[]; valori: Record<string, Record<string, number>> } {
  const colonne = perOra(righePerOra).map((o) => o.etichetta);
  const nomi = persone.filter((p) => !p.condiviso).slice(0, limite);
  const perChiave = new Map(nomi.map((p) => [p.chiave, p.nome]));
  const valori: Record<string, Record<string, number>> = {};
  for (const p of nomi) valori[p.nome] = {};
  for (const x of righePerOra?.righe ?? []) {
    const nome = x.chiavi.creatore ? perChiave.get(chiavePersona(x.chiavi.creatore)) : undefined;
    const ora = x.chiavi.ora_creazione;
    if (!nome || !ora) continue;
    valori[nome][ora] = (valori[nome][ora] ?? 0) + x.valore;
  }
  return { righe: nomi.map((p) => p.nome), colonne, valori };
}

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/**
 * Righe per mese e persona, per le aree impilate. Le persone oltre `limite`
 * confluiscono in «Altri»: sette colori per tre righe al mese non si leggono.
 */
export function serieMensili(
  righeMese: RisultatoQuery | undefined,
  anno: number,
  limite = 7
): { periodi: string[]; serie: { nome: string; valori: Record<string, number> }[] } {
  if (!righeMese) return { periodi: [], serie: [] };
  const mesi = [...new Set(righeMese.righe.map((x) => x.chiavi.periodo).filter(Boolean))].sort() as string[];
  const etichetta = (m: string) =>
    `${MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m}${m.slice(0, 4) === String(anno) ? "" : ` ${m.slice(2, 4)}`}`;
  const perPersona = new Map<string, { nome: string; mesi: Map<string, number>; totale: number }>();
  for (const x of righeMese.righe) {
    const nome = x.chiavi.creatore;
    const mese = x.chiavi.periodo;
    if (!nome || !mese) continue;
    const k = chiavePersona(nome);
    const p = perPersona.get(k) ?? { nome: nomeLeggibile(nome), mesi: new Map(), totale: 0 };
    p.mesi.set(mese, (p.mesi.get(mese) ?? 0) + x.valore);
    p.totale += x.valore;
    perPersona.set(k, p);
  }
  const ordinate = [...perPersona.values()].sort((a, b) => b.totale - a.totale);
  const principali = ordinate.slice(0, limite);
  const resto = ordinate.slice(limite);
  const serie = principali.map((p) => ({
    nome: p.nome,
    valori: Object.fromEntries(mesi.map((m) => [etichetta(m), p.mesi.get(m) ?? 0])),
  }));
  if (resto.length > 0) {
    serie.push({
      nome: "Altri",
      valori: Object.fromEntries(mesi.map((m) => [etichetta(m), resto.reduce((t, p) => t + (p.mesi.get(m) ?? 0), 0)])),
    });
  }
  return { periodi: mesi.map(etichetta), serie };
}

/** Il mix dei documenti dell'area: quanti preventivi, ordini, bolle, fatture. */
export function mixDocumenti(def: DefinizioneArea, persone: PersonaCarico[]): { etichetta: string; valore: number }[] {
  return def.gruppi
    .map((g) => ({ etichetta: g.etichetta, valore: persone.reduce((t, p) => t + (p.perGruppo[g.chiave] ?? 0), 0) }))
    .filter((x) => x.valore > 0);
}

/** Il risultato ristretto a una persona (null = tutti): il focus della vista, senza rifare la query. */
export function soloPersona(r: RisultatoQuery | undefined, chiave: string | null): RisultatoQuery | undefined {
  if (!r || !chiave) return r;
  return { ...r, righe: r.righe.filter((x) => x.chiavi.creatore && chiavePersona(x.chiavi.creatore) === chiave) };
}
