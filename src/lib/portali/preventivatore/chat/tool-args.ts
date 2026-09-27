import { z } from "zod";
import type { ToolName } from "./types";
import { TOOL_DEFINITIONS } from "./tool-definitions";

const testo = z.string().trim().min(1).max(500);
const numero = z.coerce.number().finite();
const intero = z.coerce.number().int();
const booleano = z.preprocess((valore) => {
  if (valore === "true") return true;
  if (valore === "false") return false;
  return valore;
}, z.boolean());
const stato = z.enum(["storico", "aperta", "completato"]);

const schemi: Record<ToolName, z.ZodType<Record<string, unknown>>> = {
  list_preventivi: z.object({ cliente: testo.optional(), stato: stato.optional(), categoria: testo.optional(), anno: intero.optional(), importo_min: numero.optional(), importo_max: numero.optional(), order_by: z.enum(["codice", "importo_preventivo", "importo_ordinato", "data_offerta"]).optional(), order_dir: z.enum(["asc", "desc"]).optional(), limit: intero.min(1).max(200).optional(), count_only: booleano.optional() }),
  cerca_simili: z.object({ query: testo, cliente: testo.optional(), tipo: z.enum(["storico", "generato"]).optional(), limite: intero.min(1).max(30).optional() }),
  cerca_articolo: z.object({ query: testo, codice_preventivo: testo.optional(), limite: intero.min(1).max(20).optional() }),
  aggrega_preventivi: z.object({ group_by: z.enum(["stato", "cliente", "categoria", "anno", "mese"]), metrica: z.enum(["count", "sum_importo", "avg_importo", "tasso_ordinato"]).optional(), filtro_stato: stato.optional(), filtro_cliente: testo.optional(), filtro_anno: intero.optional(), filtro_importo_min: numero.optional(), filtro_importo_max: numero.optional(), limit: intero.min(1).max(50).optional() }),
  query_righe_distinta: z.object({ modalita: z.enum(["max_prezzo", "top_costi", "cerca_codice", "cerca_descrizione"]), query: testo.optional(), categoria: testo.optional(), filtro_cliente: testo.optional(), filtro_stato: stato.optional(), limit: intero.min(1).max(50).optional() }),
  top_articoli: z.object({ categoria: testo.optional(), top_n: intero.min(1).max(30).optional(), filtro_cliente: testo.optional(), filtro_stato: stato.optional() }),
  dettaglio_preventivo: z.object({ codice: testo }),
  analisi_preventivi_sql: z.object({ modalita: z.enum(["statistiche_categoria", "statistiche_cliente", "statistiche_tipo_prodotto", "confronta_anni", "top_codici_valore", "top_codici_frequenza", "analisi_ricarichi", "analisi_lavorazioni", "controllo_qualita", "preventivi_da_completare"]), anno: intero.optional(), anno_a: intero.optional(), anno_b: intero.optional(), stato: stato.optional(), cliente: testo.optional(), categoria: testo.optional(), tipo_prodotto: testo.optional(), group_by: testo.optional(), limit: intero.min(1).max(500).optional() }),
  cerca_anomalie_importi: z.object({ classificazione: z.enum(["molto_alto", "alto", "molto_basso", "basso"]).optional(), cliente: testo.optional(), categoria: testo.optional(), anno: intero.optional(), limit: intero.min(1).max(100).optional() }),
  cerca_articolo_anagrafica: z.object({ codice: testo.optional(), descrizione: testo.optional(), categoria: testo.optional(), fornitore: testo.optional(), solo_attivi: booleano.optional(), limit: intero.min(1).max(100).optional() }),
  listino_servizi: z.object({ categoria: testo.optional() }),
  storia_prezzi_articolo: z.object({ codice: testo, anni: intero.min(1).max(30).optional() }),
  analisi_margini: z.object({ cliente: testo.optional(), categoria: testo.optional(), anno: intero.optional(), limit: intero.min(1).max(200).optional() }),
  hit_rate: z.object({ cliente: testo.optional(), categoria: testo.optional(), mesi: intero.min(1).max(120).optional(), limit: intero.min(1).max(100).optional() }),
  info_cliente: z.object({ ragione: testo, limit_preventivi: intero.min(1).max(50).optional() }),
  articoli_associati: z.object({ codice: testo, min_freq: intero.min(1).optional(), limit: intero.min(1).max(100).optional() }),
  trend_mensile: z.object({ months: intero.min(1).max(36).optional(), categoria: testo.optional() }),
};

// Pulizia degli argomenti prima della validazione. I modelli riempiono spesso i
// parametri facoltativi con valori «vuoti»: `null`, `""`, e i modelli OpenAI
// perfino `limit: 0`, `importo_max: 0` (verificato il 27/09/2026). Accettarli
// sarebbe peggio che rifiutarli — `importo_max: 0` filtrerebbe tutto a zero euro —
// quindi per i parametri facoltativi valgono come «non indicato».
function pulisci(nome: ToolName, valore: unknown): Record<string, unknown> {
  if (!valore || typeof valore !== "object" || Array.isArray(valore)) return {};
  const definizione = TOOL_DEFINITIONS.find((d) => d.name === nome);
  const obbligatori = new Set<string>(definizione?.required ?? []);
  const tipi = (definizione?.parameters_obj ?? {}) as Record<string, { type: string }>;
  return Object.fromEntries(
    Object.entries(valore).filter(([chiave, v]) => {
      if (v === null || v === "") return false;
      if (!obbligatori.has(chiave) && tipi[chiave]?.type === "number" && Number(v) === 0) return false;
      return true;
    }),
  );
}

export function validaArgomentiTool(nome: ToolName, valore: unknown): Record<string, unknown> {
  const argomenti = pulisci(nome, valore);
  const esito = schemi[nome].safeParse(argomenti);
  if (esito.success) return esito.data;
  // Un parametro facoltativo non valido si scarta invece di far fallire la
  // chiamata (il modello leggerebbe l'errore e risponderebbe a vuoto); un
  // obbligatorio sbagliato resta un errore.
  const obbligatori = new Set<string>(TOOL_DEFINITIONS.find((d) => d.name === nome)?.required ?? []);
  const invalidi = new Set(esito.error.issues.map((issue) => String(issue.path[0] ?? "")));
  if ([...invalidi].some((chiave) => !chiave || obbligatori.has(chiave))) throw esito.error;
  return schemi[nome].parse(Object.fromEntries(Object.entries(argomenti).filter(([chiave]) => !invalidi.has(chiave))));
}
