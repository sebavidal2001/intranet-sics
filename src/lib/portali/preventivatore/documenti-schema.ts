import { z } from "zod";

// ── Schema Zod del payload builder (create + update) ─────────────────────────
// Condiviso tra POST /documenti (crea) e PUT /documenti/[id] (modifica in place).
// Limiti severi per evitare valori sporchi (negativi, infinity, NaN, stringhe lunghe).

const NUM_POS = z.number().finite().nonnegative();
const COEFF = z.number().finite().gt(0).lte(2); // coeff > 0 e ≤ 2 (margine 0% al 100%)

const ArticoloSchema = z.object({
  codice: z.string().trim().max(64),
  descrizione: z.string().trim().max(500),
  qty: NUM_POS.max(100000),
  ult_costo: NUM_POS.max(10_000_000),
  coeff_ricarico: COEFF,
});

const ServizioSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  categoria: z.string().trim().max(80).optional(),
  ore: NUM_POS.max(100000),
  tariffa_ora: NUM_POS.max(1000),
  coeff_ricarico: COEFF,
  scala_con_quantita: z.boolean().optional(),
});

const PCT = z.number().finite().min(0).max(1000);

const BloccoSchema = z.object({
  nome: z.string().trim().max(120).optional(),
  tipo: z.string().trim().max(80).optional(),
  note: z.string().trim().max(2000).optional(),
  quantita_pezzi: z.number().int().min(1).max(100000).optional(),
  margine_trattativa_pct: PCT.optional(),
  articoli: z.array(ArticoloSchema).default([]),
  servizi: z.array(ServizioSchema).default([]),
});

export const PostBodySchema = z.object({
  titolo: z.string().trim().max(200).optional(),
  cliente_master_id: z.string().uuid().optional(),
  cliente_text: z.string().trim().max(200).optional(),
  numero_preventivo: z.string().trim().max(64).optional(),
  data_consegna: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  consegna_settimane_min: z.number().int().min(0).max(260).optional(),
  consegna_settimane_max: z.number().int().min(0).max(260).optional(),
  margine_trattativa_pct: PCT.optional(),
  // Tempo cronometrato nel builder (secondi). Cap a 30 giorni di lavoro attivo.
  tempo_preventivazione_sec: z.number().int().min(0).max(2_592_000).optional(),
  codice: z.string().trim().regex(/^[GSC]_\d{2}_[\w-]+$/).max(32).optional(),
  note: z.string().trim().max(4000).optional(),
  blocchi: z.array(BloccoSchema).min(1, "Almeno un blocco è richiesto"),
}).refine(
  (b) => Boolean(b.cliente_master_id) || Boolean(b.cliente_text && b.cliente_text.length > 0),
  { message: "Cliente mancante (cliente_master_id o cliente_text)" }
).refine(
  (b) => b.blocchi.some((bl) => bl.articoli.length > 0 || bl.servizi.length > 0),
  { message: "Almeno un blocco deve contenere articoli o servizi" }
);

export type BuilderPayload = z.infer<typeof PostBodySchema>;
