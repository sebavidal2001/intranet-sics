/**
 * MODIFICARE UN RIQUADRO A PAROLE — il nucleo, senza AI.
 *
 * Chi chiede «aggiungi il confronto con l'anno scorso, togli il budget, filtra
 * su Boni» non fa scrivere all'assistente un riquadro nuovo: l'assistente
 * restituisce un ELENCO DI OPERAZIONI da un vocabolario chiuso, e questo modulo
 * le applica allo stato del riquadro con una funzione pura. Ogni spec che ne
 * esce passa dal validatore, quindi:
 *
 *  - nessun numero inventato: i numeri li ricalcola il motore sul nuovo stato;
 *  - nessun accesso fuori perimetro: il perimetro e' applicato allo snapshot, e
 *    i valori dei filtri si controllano su quello dell'utente;
 *  - nessuna modifica "a meta'": o si applicano tutte o nessuna, e un rifiuto
 *    torna all'assistente col motivo perche' si corregga.
 *
 * Chi chiama (l'editor) mostra il prima e il dopo calcolando il nuovo stato con
 * le stesse API di sempre, e applica solo se l'utente conferma.
 *
 * Regole che tengono il riquadro coerente (sono quelle dell'editor):
 *  - suddivisione, granularita' e periodo valgono per TUTTE le serie;
 *  - un filtro vale per tutte le serie a cui si applica; dove non si applica
 *    (budget per cliente, dimensione di un altro dominio) si salta e si dichiara;
 *  - una misura personalizzata ha gia' i suoi filtri: un filtro sulla stessa
 *    famiglia non la tocca (come per i filtri di pagina) e lo si dichiara.
 */

import { ammetteConfrontoBudget, motivoBudgetNonDisponibile, validaSerieAnalisi } from "./analisi-composita";
import { famiglia } from "./filtri-pagina";
import { dimensioneAmmessaDallaMisura, normalizzaFiltri, operandiDellaMisura } from "./misure";
import { chiaveDellaSpec, eChiaveMisura, specPerChiave, type ChiaveCampo } from "./misure-vocabolario";
import { descriviPeriodo, periodoPresente } from "./periodo";
import { NOMI_GRAFICI, type TipoGrafico } from "./scelta-grafico";
import { CATALOGO, DIMENSIONI, SpecNonValida, dimensioneFuoriDominio, validaSpec } from "./semantico";
import { dimensioniPerMetrica } from "./tassonomia";
import type {
  AspettoGrafico,
  ChiaveMetrica,
  Dimensione,
  Filtro,
  Granularita,
  MisuraDefinita,
  Periodo,
  RuoloSerie,
  SerieAnalisi,
  Snapshot,
  SpecQuery,
} from "./tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Stato e operazioni
// ─────────────────────────────────────────────────────────────────────────────

/** Cio' che l'assistente puo' cambiare di un riquadro. La serie principale e' la prima. */
export interface StatoRiquadro {
  titolo: string;
  serie: SerieAnalisi[];
  /** `undefined` = lo sceglie il sistema leggendo la forma del risultato. */
  grafico?: TipoGrafico;
}

export type RuoloAggiunta = "confronto" | "obiettivo" | "soglia";

export type OperazioneRiquadro =
  | { op: "aggiungi_serie"; metrica: string; ruolo?: RuoloAggiunta; nome?: string }
  | { op: "aggiungi_confronto"; tipo: "anno_precedente" | "progressivo" }
  | { op: "togli_serie"; nome?: string; ruolo?: RuoloSerie }
  | { op: "imposta_misura_principale"; metrica: string }
  | { op: "imposta_filtro"; campo: Dimensione; operatore: Filtro["op"]; valore: string | string[] }
  | { op: "togli_filtro"; campo: Dimensione }
  | { op: "imposta_suddivisione"; dimensioni: Dimensione[] }
  | { op: "imposta_granularita"; granularita: Granularita | null }
  | { op: "imposta_periodo"; periodo: Periodo | null }
  | { op: "imposta_grafico"; tipo: TipoGrafico | null }
  | { op: "imposta_titolo"; titolo: string };

export const NOMI_OPERAZIONI = [
  "aggiungi_serie",
  "aggiungi_confronto",
  "togli_serie",
  "imposta_misura_principale",
  "imposta_filtro",
  "togli_filtro",
  "imposta_suddivisione",
  "imposta_granularita",
  "imposta_periodo",
  "imposta_grafico",
  "imposta_titolo",
] as const;

export interface ContestoModifica {
  /** Lo snapshot perimetrato di chi chiede: serve a controllare i valori dei filtri. */
  snapshot: Snapshot;
  /** Le misure personalizzate disponibili, per chiave (`misura:<id>`). */
  definizioni: Record<string, MisuraDefinita>;
}

export interface EsitoModifica {
  stato: StatoRiquadro;
  /** Una riga per operazione, in italiano: e' quello che l'utente legge prima di applicare. */
  riepilogo: string[];
  /** Cio' che non si e' potuto applicare a qualche serie, e perche'. */
  ignorati: string[];
  /** Vero se lo stato finale e' identico a quello di partenza. */
  invariato: boolean;
}

const MAX_OPERAZIONI = 8;
const MAX_SERIE = 8;
const MAX_TITOLO = 120;
const MAX_NOME_SERIE = 60;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/u;
const GRANULARITA: readonly Granularita[] = ["giorno", "settimana", "mese", "anno"];
const OPERATORI: readonly Filtro["op"][] = ["eq", "neq", "in", "contiene"];
const RUOLI: readonly RuoloSerie[] = ["principale", "confronto", "obiettivo", "soglia"];

function oggetto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validazione delle operazioni (arrivano dal modello: nulla e' fidato)
// ─────────────────────────────────────────────────────────────────────────────

function testo(v: unknown, campo: string, massimo: number): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new SpecNonValida(`«${campo}» deve essere un testo non vuoto.`);
  if (v.trim().length > massimo) throw new SpecNonValida(`«${campo}» e' troppo lungo (massimo ${massimo} caratteri).`);
  return v.trim();
}

function dimensione(v: unknown, campo = "campo"): Dimensione {
  const d = String(v ?? "") as Dimensione;
  if (!DIMENSIONI[d]) {
    throw new SpecNonValida(`La dimensione "${String(v)}" (${campo}) non esiste.`, `Esistenti: ${Object.keys(DIMENSIONI).join(", ")}.`);
  }
  return d;
}

function anno(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 2000 || v > 2100) {
    throw new SpecNonValida(`Anno non valido: ${String(v)}.`, "Un anno intero fra 2000 e 2100.");
  }
  return v;
}

function validaPeriodoOperazione(o: Record<string, unknown>): Periodo | null {
  if (o.eredita === true) return null;
  const periodo: Periodo = {};
  if (o.anno !== undefined) periodo.anno = anno(o.anno);
  if (o.anni !== undefined) {
    if (!Array.isArray(o.anni) || o.anni.length === 0 || o.anni.length > 10) throw new SpecNonValida("«anni» deve essere un elenco di 1-10 anni.");
    periodo.anni = o.anni.map(anno);
  }
  for (const k of ["dal", "al"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "string" || !DATA_ISO.test(o[k] as string)) {
      throw new SpecNonValida(`«${k}» deve essere una data nel formato aaaa-mm-gg.`);
    }
    periodo[k] = o[k] as string;
  }
  if (periodo.dal && periodo.al && periodo.dal > periodo.al) {
    throw new SpecNonValida(`Il periodo e' incoerente: «dal» (${periodo.dal}) e' dopo «al» (${periodo.al}).`);
  }
  if (Object.keys(periodo).length === 0) {
    throw new SpecNonValida(
      "Il periodo e' vuoto.",
      "Indica anno, anni, dal/al oppure eredita:true per far seguire alla dashboard il suo periodo."
    );
  }
  return periodo;
}

export function validaOperazioni(grezze: unknown): OperazioneRiquadro[] {
  if (!Array.isArray(grezze) || grezze.length === 0) throw new SpecNonValida("Serve almeno un'operazione.");
  if (grezze.length > MAX_OPERAZIONI) throw new SpecNonValida(`Troppe operazioni (${grezze.length}): massimo ${MAX_OPERAZIONI}.`);

  return grezze.map((g, i): OperazioneRiquadro => {
    if (!oggetto(g)) throw new SpecNonValida(`L'operazione ${i + 1} non e' un oggetto.`);
    const nome = String(g.op ?? "");
    switch (nome) {
      case "aggiungi_serie": {
        const ruolo = g.ruolo === undefined ? undefined : String(g.ruolo);
        if (ruolo !== undefined && !["confronto", "obiettivo", "soglia"].includes(ruolo)) {
          throw new SpecNonValida(`Ruolo "${ruolo}" non valido per una serie aggiunta.`, "Ruoli: confronto, obiettivo, soglia.");
        }
        return {
          op: nome,
          metrica: testo(g.metrica, "metrica", 80),
          ...(ruolo ? { ruolo: ruolo as RuoloAggiunta } : {}),
          ...(g.nome !== undefined ? { nome: testo(g.nome, "nome", MAX_NOME_SERIE) } : {}),
        };
      }
      case "aggiungi_confronto": {
        if (g.tipo !== "anno_precedente" && g.tipo !== "progressivo") {
          throw new SpecNonValida(`Tipo di confronto "${String(g.tipo)}" non valido.`, "Tipi: anno_precedente, progressivo.");
        }
        return { op: nome, tipo: g.tipo };
      }
      case "togli_serie": {
        const ruolo = g.ruolo === undefined ? undefined : String(g.ruolo);
        if (ruolo !== undefined && !RUOLI.includes(ruolo as RuoloSerie)) throw new SpecNonValida(`Ruolo "${ruolo}" non valido.`);
        if (g.nome === undefined && ruolo === undefined) {
          throw new SpecNonValida("Per togliere una serie indica il nome o il ruolo.");
        }
        return {
          op: nome,
          ...(g.nome !== undefined ? { nome: testo(g.nome, "nome", 80) } : {}),
          ...(ruolo ? { ruolo: ruolo as RuoloSerie } : {}),
        };
      }
      case "imposta_misura_principale":
        return { op: nome, metrica: testo(g.metrica, "metrica", 80) };
      case "imposta_filtro": {
        const campo = dimensione(g.campo);
        const operatore = g.operatore === undefined ? undefined : String(g.operatore);
        if (operatore !== undefined && !OPERATORI.includes(operatore as Filtro["op"])) {
          throw new SpecNonValida(`Operatore "${operatore}" non valido.`, "Operatori: eq, neq, in, contiene.");
        }
        let valore: string | string[];
        if (Array.isArray(g.valore)) {
          if (g.valore.length === 0 || g.valore.length > 30) throw new SpecNonValida("Un elenco di valori ha da 1 a 30 voci.");
          valore = g.valore.map((v) => testo(v, "valore", 120));
        } else {
          valore = testo(g.valore, "valore", 120);
        }
        const op: Filtro["op"] = (operatore as Filtro["op"] | undefined) ?? (Array.isArray(valore) ? "in" : "eq");
        if (Array.isArray(valore) && op !== "in") {
          throw new SpecNonValida(`Con piu' valori l'operatore e' "in", non "${op}".`);
        }
        return { op: nome, campo, operatore: op, valore };
      }
      case "togli_filtro":
        return { op: nome, campo: dimensione(g.campo) };
      case "imposta_suddivisione": {
        if (!Array.isArray(g.dimensioni) || g.dimensioni.length > 2) {
          throw new SpecNonValida("La suddivisione ha al massimo due dimensioni (anche nessuna, per il totale).");
        }
        const dimensioni = g.dimensioni.map((d) => dimensione(d, "dimensioni"));
        if (new Set(dimensioni).size !== dimensioni.length) throw new SpecNonValida("Le dimensioni della suddivisione devono essere diverse.");
        return { op: nome, dimensioni };
      }
      case "imposta_granularita": {
        if (g.granularita !== null && !GRANULARITA.includes(g.granularita as Granularita)) {
          throw new SpecNonValida(`Granularita' "${String(g.granularita)}" non valida.`, `Valide: ${GRANULARITA.join(", ")}, oppure null per il totale.`);
        }
        return { op: nome, granularita: g.granularita as Granularita | null };
      }
      case "imposta_periodo":
        return { op: nome, periodo: validaPeriodoOperazione(g) };
      case "imposta_grafico": {
        if (g.tipo === "automatico" || g.tipo === null) return { op: nome, tipo: null };
        if (typeof g.tipo !== "string" || !(g.tipo in NOMI_GRAFICI)) {
          throw new SpecNonValida(`Tipo di grafico "${String(g.tipo)}" non esiste.`, `Disponibili: ${Object.keys(NOMI_GRAFICI).join(", ")}, oppure "automatico".`);
        }
        return { op: nome, tipo: g.tipo as TipoGrafico };
      }
      case "imposta_titolo":
        return { op: nome, titolo: testo(g.titolo, "titolo", MAX_TITOLO) };
      default:
        throw new SpecNonValida(`Operazione "${nome}" non esiste.`, `Operazioni: ${NOMI_OPERAZIONI.join(", ")}.`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilita'
// ─────────────────────────────────────────────────────────────────────────────

function copia<T>(v: T): T {
  return structuredClone(v);
}

/** Toglie cio' che il validatore aggiunge come default: la spec resta come la scriverebbe l'editor. */
function snellisci(spec: SpecQuery): SpecQuery {
  const s: SpecQuery = { ...spec };
  if (!s.raggruppa?.length) delete s.raggruppa;
  if (!s.filtri?.length) delete s.filtri;
  if (!periodoPresente(s.periodo)) delete s.periodo;
  for (const k of Object.keys(s) as Array<keyof SpecQuery>) if (s[k] === undefined) delete s[k];
  return s;
}

function etichettaDi(chiave: ChiaveCampo, definizioni: Record<string, MisuraDefinita>): string {
  if (eChiaveMisura(chiave)) return definizioni[chiave]?.nome ?? chiave;
  return CATALOGO[chiave]?.etichetta ?? chiave;
}

function etichettaSerieSpec(spec: SpecQuery): string {
  return spec.misura?.nome ?? CATALOGO[spec.metrica]?.etichetta ?? spec.metrica;
}

/** Una metrica del catalogo o una misura (per chiave o per nome). */
function risolviMetrica(riferimento: string, definizioni: Record<string, MisuraDefinita>): ChiaveCampo {
  if (CATALOGO[riferimento as ChiaveMetrica]) return riferimento as ChiaveMetrica;
  if (eChiaveMisura(riferimento) && definizioni[riferimento]) return riferimento;
  const perNome = Object.entries(definizioni).find(([, d]) => d.nome.trim().toLowerCase() === riferimento.trim().toLowerCase());
  if (perNome) return perNome[0] as ChiaveCampo;
  throw new SpecNonValida(
    `La metrica "${riferimento}" non esiste.`,
    `Metriche: ${Object.keys(CATALOGO).join(", ")}.` +
      (Object.keys(definizioni).length ? ` Misure personalizzate: ${Object.entries(definizioni).map(([k, d]) => `${k} («${d.nome}»)`).join(", ")}.` : "")
  );
}

function eObiettivo(spec: SpecQuery): boolean {
  return !spec.misura && (spec.metrica === "budget" || spec.metrica === "bep");
}

/** Le famiglie su cui una misura ha gia' deciso con i filtri dei suoi operandi. */
function famiglieDellaMisura(spec: SpecQuery): Set<string> {
  if (!spec.misura) return new Set();
  return new Set(
    operandiDellaMisura(spec.misura.espressione).flatMap((o) => (o.filtri ?? []).map((f) => famiglia(f.campo)))
  );
}

/** Perche' un filtro non si applica a questa serie, o null se si applica. */
function motivoNonApplicabile(spec: SpecQuery, campo: Dimensione): string | null {
  const nome = etichettaSerieSpec(spec);
  if (spec.misura) {
    if (!dimensioneAmmessaDallaMisura(spec.misura, campo)) return `la dimensione non vale per tutti i pezzi di «${nome}»`;
    if (famiglieDellaMisura(spec).has(famiglia(campo))) return `«${nome}» ha gia' il suo filtro su quella dimensione`;
    return null;
  }
  if (eObiettivo(spec)) {
    return campo === "bu" || campo === "agente" || campo === "bu_categoria"
      ? null
      : `il ${nome.toLowerCase()} esiste solo per business unit e agente`;
  }
  if (dimensioneFuoriDominio(spec.metrica, campo)) return `la dimensione e' di un altro dominio rispetto a «${nome}»`;
  if (!dimensioniPerMetrica(spec.metrica).includes(campo) && campo !== "bu_categoria") {
    return `la dimensione non esiste per «${nome}»`;
  }
  return null;
}

function nomeUnico(serie: SerieAnalisi[], ruolo: RuoloSerie, voluto: string): string {
  const presenti = new Set(serie.filter((s) => s.ruolo === ruolo).map((s) => s.nome.trim().toLowerCase()));
  if (!presenti.has(voluto.trim().toLowerCase())) return voluto;
  for (let n = 2; n < 20; n += 1) {
    const prova = `${voluto} (${n})`;
    if (!presenti.has(prova.toLowerCase())) return prova;
  }
  return voluto;
}

function principale(stato: StatoRiquadro): SerieAnalisi {
  return stato.serie[0];
}

/** Una serie "uguale" per scopo a un'altra: stessa voce dell'albero e stesso modificatore. */
function stessaDomanda(a: SpecQuery, b: SpecQuery): boolean {
  return chiaveDellaSpec(a) === chiaveDellaSpec(b) && (a.modificatore ?? "corrente") === (b.modificatore ?? "corrente");
}

/**
 * La spec di una serie nuova: la stessa domanda della principale (suddivisione,
 * granularita', periodo, filtri) su un'altra voce dell'albero o con un altro
 * modificatore. Restituisce anche i filtri che non si applicano.
 */
function specDerivata(
  base: SpecQuery,
  chiave: ChiaveCampo,
  modificatore: SpecQuery["modificatore"],
  definizioni: Record<string, MisuraDefinita>
): { spec: SpecQuery; saltati: Array<{ filtro: Filtro; motivo: string }> } {
  const partenza: SpecQuery = {
    metrica: "ordinato",
    modificatore,
    ...(base.raggruppa?.length ? { raggruppa: [...base.raggruppa] } : {}),
    ...(base.granularita ? { granularita: base.granularita } : {}),
    ...(base.periodo ? { periodo: copia(base.periodo) } : {}),
  };
  const spec = specPerChiave(partenza, chiave, definizioni);
  if (!spec) throw new SpecNonValida(`La misura "${chiave}" non e' disponibile.`);
  const applicabili: Filtro[] = [];
  const saltati: Array<{ filtro: Filtro; motivo: string }> = [];
  for (const f of base.filtri ?? []) {
    const motivo = motivoNonApplicabile(spec, f.campo);
    if (motivo) saltati.push({ filtro: f, motivo });
    else applicabili.push(copia(f));
  }
  if (applicabili.length) spec.filtri = applicabili;
  return { spec, saltati };
}

function descriviFiltroBreve(f: Filtro): string {
  const v = Array.isArray(f.valore) ? f.valore.join(", ") : String(f.valore);
  const op = f.op === "eq" ? "=" : f.op === "neq" ? "diverso da" : f.op === "in" ? "è fra" : "contiene";
  return `${DIMENSIONI[f.campo].etichetta} ${op} ${v}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Applicazione
// ─────────────────────────────────────────────────────────────────────────────

export function applicaOperazioni(
  iniziale: StatoRiquadro,
  operazioni: OperazioneRiquadro[],
  contesto: ContestoModifica
): EsitoModifica {
  const { snapshot, definizioni } = contesto;
  const stato: StatoRiquadro = copia(iniziale);
  if (stato.serie.length === 0) throw new SpecNonValida("Il riquadro non ha serie.");
  const riepilogo: string[] = [];
  const ignorati = new Set<string>();

  for (const o of operazioni) {
    switch (o.op) {
      case "aggiungi_serie": {
        const chiave = risolviMetrica(o.metrica, definizioni);
        const ruolo: RuoloAggiunta =
          o.ruolo ?? (chiave === "budget" ? "obiettivo" : chiave === "bep" ? "soglia" : "confronto");
        const { spec, saltati } = specDerivata(principale(stato).spec, chiave, "corrente", definizioni);
        if (stato.serie.some((s) => s.ruolo !== "principale" && stessaDomanda(s.spec, spec)) ||
            stessaDomanda(principale(stato).spec, spec)) {
          ignorati.add(`«${etichettaDi(chiave, definizioni)}» e' gia' nel riquadro: non l'ho aggiunta due volte.`);
          break;
        }
        for (const s of saltati) ignorati.add(`Il filtro «${descriviFiltroBreve(s.filtro)}» non si applica a «${etichettaDi(chiave, definizioni)}»: ${s.motivo}.`);
        const nome = nomeUnico(stato.serie, ruolo, o.nome ?? etichettaDi(chiave, definizioni));
        stato.serie.push({ ruolo, nome, spec });
        riepilogo.push(`Aggiungo la serie «${nome}» (${ruolo})`);
        break;
      }

      case "aggiungi_confronto": {
        const base = principale(stato).spec;
        const modificatore = o.tipo;
        const spec: SpecQuery = { ...copia(base), modificatore };
        if (stato.serie.some((s) => s.ruolo !== "principale" && stessaDomanda(s.spec, spec))) {
          ignorati.add(`Il confronto «${o.tipo === "anno_precedente" ? "anno precedente" : "progressivo"}» c'e' gia'.`);
          break;
        }
        if ((base.modificatore ?? "corrente") !== "corrente") {
          throw new SpecNonValida(
            `La misura principale ha gia' il modificatore «${base.modificatore}»: il confronto si aggiunge a una misura nel periodo corrente.`
          );
        }
        const nome = nomeUnico(stato.serie, "confronto", o.tipo === "anno_precedente" ? "Anno precedente" : "Progressivo");
        stato.serie.push({ ruolo: "confronto", nome, spec });
        riepilogo.push(`Aggiungo il confronto «${nome}»`);
        break;
      }

      case "togli_serie": {
        const extra = stato.serie.map((s, i) => ({ s, i })).filter(({ i }) => i > 0);
        const riferimento = o.nome?.trim().toLowerCase();
        const corrisponde = (s: SerieAnalisi) => {
          if (o.ruolo && s.ruolo !== o.ruolo) return false;
          if (!riferimento) return true;
          return (
            s.nome.trim().toLowerCase() === riferimento ||
            String(chiaveDellaSpec(s.spec)).toLowerCase() === riferimento ||
            etichettaSerieSpec(s.spec).toLowerCase() === riferimento
          );
        };
        const daTogliere = extra.filter(({ s }) => corrisponde(s));
        if (daTogliere.length === 0) {
          if (corrisponde(principale(stato))) {
            throw new SpecNonValida(
              "La serie principale non si toglie.",
              "Per cambiarla usa imposta_misura_principale; per un riquadro diverso, creane uno nuovo."
            );
          }
          throw new SpecNonValida(
            `Nessuna serie corrisponde a ${o.nome ? `"${o.nome}"` : `ruolo "${o.ruolo}"`}.`,
            `Serie presenti: ${stato.serie.map((s) => `«${s.nome}» (${s.ruolo})`).join(", ")}.`
          );
        }
        const indici = new Set(daTogliere.map(({ i }) => i));
        stato.serie = stato.serie.filter((_, i) => !indici.has(i));
        for (const { s } of daTogliere) riepilogo.push(`Tolgo la serie «${s.nome}»`);
        break;
      }

      case "imposta_misura_principale": {
        const chiave = risolviMetrica(o.metrica, definizioni);
        const attuale = principale(stato);
        if (chiaveDellaSpec(attuale.spec) === chiave) {
          ignorati.add(`La misura principale e' gia' «${etichettaDi(chiave, definizioni)}».`);
          break;
        }
        const { spec, saltati } = specDerivata(
          attuale.spec,
          chiave,
          attuale.spec.modificatore ?? "corrente",
          definizioni
        );
        for (const s of saltati) ignorati.add(`Il filtro «${descriviFiltroBreve(s.filtro)}» non si applica a «${etichettaDi(chiave, definizioni)}»: ${s.motivo}.`);
        // Il nome segue la misura solo se era quello di default.
        const eraDefault = [etichettaSerieSpec(attuale.spec), String(attuale.spec.metrica)].includes(attuale.nome);
        const nome = eraDefault ? etichettaDi(chiave, definizioni) : attuale.nome;
        stato.serie[0] = { ...attuale, nome, spec };
        riepilogo.push(`Misura principale: «${etichettaDi(chiave, definizioni)}»`);
        break;
      }

      case "imposta_filtro": {
        const prima = principale(stato).spec;
        const motivoPrincipale = motivoNonApplicabile(prima, o.campo);
        if (motivoPrincipale) {
          throw new SpecNonValida(
            `Il filtro su "${o.campo}" non si applica alla misura principale: ${motivoPrincipale}.`,
            `Per «${etichettaSerieSpec(prima)}» hanno senso: ${dimensioniPerMetrica(prima.metrica).join(", ")}.`
          );
        }
        // I valori si controllano una volta, sulla principale, nel perimetro
        // di chi chiede; alle altre serie si dà la stessa grafia (un cliente
        // puo' avere ordini e non fatture nel periodo: non e' un errore).
        const filtro = normalizzaFiltri(prima.metrica, [{ campo: o.campo, op: o.operatore, valore: o.valore }], snapshot)[0];
        for (const s of stato.serie) {
          const motivo = motivoNonApplicabile(s.spec, o.campo);
          if (motivo) {
            ignorati.add(`Il filtro «${descriviFiltroBreve(filtro)}» non si applica a «${s.nome}»: ${motivo}.`);
            continue;
          }
          const altri = (s.spec.filtri ?? []).filter((f) => f.campo !== o.campo);
          s.spec = { ...s.spec, filtri: [...altri, copia(filtro)] };
        }
        riepilogo.push(`Filtro: ${descriviFiltroBreve(filtro)}`);
        break;
      }

      case "togli_filtro": {
        let tolto = false;
        for (const s of stato.serie) {
          const rimasti = (s.spec.filtri ?? []).filter((f) => f.campo !== o.campo);
          if (rimasti.length !== (s.spec.filtri ?? []).length) tolto = true;
          const spec: SpecQuery = { ...s.spec };
          if (rimasti.length) spec.filtri = rimasti;
          else delete spec.filtri;
          s.spec = spec;
        }
        if (!tolto) ignorati.add(`Non c'era nessun filtro su ${DIMENSIONI[o.campo].etichetta}.`);
        else riepilogo.push(`Tolgo il filtro su ${DIMENSIONI[o.campo].etichetta}`);
        break;
      }

      case "imposta_suddivisione": {
        for (const s of stato.serie) {
          const spec: SpecQuery = { ...s.spec };
          if (o.dimensioni.length) spec.raggruppa = [...o.dimensioni];
          else delete spec.raggruppa;
          s.spec = spec;
        }
        riepilogo.push(
          o.dimensioni.length
            ? `Suddivido per ${o.dimensioni.map((d) => DIMENSIONI[d].etichetta).join(" e ")}`
            : "Tolgo la suddivisione (resta il totale)"
        );
        break;
      }

      case "imposta_granularita": {
        for (const s of stato.serie) {
          const spec: SpecQuery = { ...s.spec };
          if (o.granularita) spec.granularita = o.granularita;
          else delete spec.granularita;
          s.spec = spec;
        }
        riepilogo.push(o.granularita ? `Andamento per ${o.granularita}` : "Tolgo l'andamento nel tempo (resta il totale)");
        break;
      }

      case "imposta_periodo": {
        for (const s of stato.serie) {
          const spec: SpecQuery = { ...s.spec };
          if (o.periodo) spec.periodo = copia(o.periodo);
          else delete spec.periodo;
          s.spec = spec;
        }
        riepilogo.push(o.periodo ? `Periodo: ${descriviPeriodo(o.periodo)}` : "Periodo: segue la dashboard");
        break;
      }

      case "imposta_grafico": {
        if (o.tipo) stato.grafico = o.tipo;
        else delete stato.grafico;
        riepilogo.push(o.tipo ? `Grafico: ${NOMI_GRAFICI[o.tipo]}` : "Grafico: scelto in automatico");
        break;
      }

      case "imposta_titolo": {
        stato.titolo = o.titolo;
        riepilogo.push(`Titolo: «${o.titolo}»`);
        break;
      }
    }
  }

  if (stato.serie.length > MAX_SERIE) {
    throw new SpecNonValida(`Il riquadro avrebbe ${stato.serie.length} serie: massimo ${MAX_SERIE}.`, "Togline qualcuna.");
  }

  // ── Controlli finali sullo stato intero ────────────────────────────────────
  // Budget e BEP esistono solo per business unit e agente: si controlla alla
  // fine, cosi' le operazioni possono stare in qualunque ordine.
  const finale = validaSerieAnalisi(stato.serie);
  for (const s of finale) {
    if (eObiettivo(s.spec) && !ammetteConfrontoBudget(s.spec)) {
      throw new SpecNonValida(
        motivoBudgetNonDisponibile(s.spec) ?? "Budget e BEP non esistono per questa suddivisione.",
        `Togli la serie «${s.nome}» (togli_serie) oppure suddividi per business unit o agente.`
      );
    }
  }
  stato.serie = finale.map((s) => ({ ...s, spec: snellisci(s.spec) }));

  const prima = validaSerieAnalisi(iniziale.serie).map((s) => ({ ...s, spec: snellisci(s.spec) }));
  const invariato =
    JSON.stringify({ t: iniziale.titolo, g: iniziale.grafico ?? null, s: prima }) ===
    JSON.stringify({ t: stato.titolo, g: stato.grafico ?? null, s: stato.serie });

  return { stato, riepilogo, ignorati: [...ignorati], invariato };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dal nuovo stato all'editor
// ─────────────────────────────────────────────────────────────────────────────

export type ScorciatoiaSerie = "anno_precedente" | "budget" | "bep" | "progressivo";

/**
 * Se una serie e' una "scorciatoia" dell'editor: la sua spec deriva da quella
 * della principale e l'editor la rigenera a ogni cambio. Va riconosciuta quando
 * si adotta un nuovo stato, altrimenti la serie resterebbe ferma mentre la
 * principale cambia.
 */
export function scorciatoiaDi(serie: SerieAnalisi, principaleSerie: SerieAnalisi): ScorciatoiaSerie | undefined {
  const spec = serie.spec;
  if (!spec.misura && serie.ruolo === "obiettivo" && spec.metrica === "budget") return "budget";
  if (!spec.misura && serie.ruolo === "soglia" && spec.metrica === "bep") return "bep";
  if (chiaveDellaSpec(spec) !== chiaveDellaSpec(principaleSerie.spec)) return undefined;
  if (spec.modificatore === "anno_precedente") return "anno_precedente";
  if (spec.modificatore === "progressivo") return "progressivo";
  return undefined;
}

/**
 * Le differenze della tabella puntano alle serie per POSIZIONE: se una serie
 * sparisce o si sposta, gli indici vanno riportati, e le differenze che
 * puntavano a una serie tolta vanno via con lei.
 */
export function riallineaDifferenze(
  aspetto: AspettoGrafico | null,
  prima: SerieAnalisi[],
  dopo: SerieAnalisi[]
): AspettoGrafico | null {
  const differenze = aspetto?.tabella?.differenze;
  if (!aspetto || !differenze) return aspetto;
  const chiave = (s: SerieAnalisi) => `${s.ruolo}|${s.nome}`;
  const nuovaPosizione = new Map(dopo.map((s, i) => [chiave(s), i]));
  const aggiornate = differenze.flatMap((d) => {
    const da = prima[d.da] ? nuovaPosizione.get(chiave(prima[d.da])) : undefined;
    const con = prima[d.con] ? nuovaPosizione.get(chiave(prima[d.con])) : undefined;
    return da === undefined || con === undefined || da === con ? [] : [{ ...d, da, con }];
  });
  return { ...aspetto, tabella: { ...aspetto.tabella, differenze: aggiornate } };
}
