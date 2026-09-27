import { z } from "zod";

export const MAX_CARATTERI_SCHEDA = 60_000;

// ── Schema Zod del payload builder (create + update) ─────────────────────────
// Condiviso tra POST /documenti (crea) e PUT /documenti/[id] (modifica in place).
// Limiti severi per evitare valori sporchi (negativi, infinity, NaN, stringhe lunghe).

const NUM_POS = z.number().finite().nonnegative();
const COEFF = z.number().finite().gt(0).lte(2); // coeff > 0 e ≤ 2 (margine 0% al 100%)

export const LIMITI_SERVIZIO = {
  nome: 120,
  categoria: 80,
  tariffaOra: 1_000,
} as const;

export const ServizioConfigurazioneSchema = z.object({
  nome: z.string().trim().min(1, "Nome obbligatorio").max(LIMITI_SERVIZIO.nome),
  categoria: z.string().trim().max(LIMITI_SERVIZIO.categoria),
  tariffa_ora: NUM_POS.max(LIMITI_SERVIZIO.tariffaOra),
});

export const LIMITI_TEMPLATE_DOCUMENTO = {
  descrizione: 500,
  codiceArticolo: 64,
  nomeLavorazione: LIMITI_SERVIZIO.nome,
  categoria: LIMITI_SERVIZIO.categoria,
  tariffa: LIMITI_SERVIZIO.tariffaOra,
} as const;

export const TemplateCompatibileDocumentoSchema = z.object({
  descrizione: z.string().max(LIMITI_TEMPLATE_DOCUMENTO.descrizione).nullable().optional(),
  righe_materiale: z.array(z.object({
    descrizione: z.string().trim().max(LIMITI_TEMPLATE_DOCUMENTO.descrizione),
    codice_articolo: z.string().trim().max(LIMITI_TEMPLATE_DOCUMENTO.codiceArticolo).nullable().optional(),
    gruppo: z.string().trim().max(LIMITI_TEMPLATE_DOCUMENTO.categoria).nullable().optional(),
  }).passthrough()),
  righe_manodopera: z.array(z.object({
    label: z.string().trim().min(1).max(LIMITI_TEMPLATE_DOCUMENTO.nomeLavorazione),
    tariffa_default: NUM_POS.max(LIMITI_TEMPLATE_DOCUMENTO.tariffa),
  }).passthrough()),
}).passthrough();

const ArticoloSchema = z.object({
  codice: z.string().trim().max(64),
  descrizione: z.string().trim().max(500),
  qty: NUM_POS.max(100000),
  ult_costo: NUM_POS.max(10_000_000),
  coeff_ricarico: COEFF,
});

export const ServizioSchema = z.object({
  nome: ServizioConfigurazioneSchema.shape.nome,
  categoria: ServizioConfigurazioneSchema.shape.categoria.optional(),
  ore: NUM_POS.max(100000),
  tariffa_ora: ServizioConfigurazioneSchema.shape.tariffa_ora,
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
  // Lock ottimistico: valorizzato dalla GET quando il builder modifica un documento.
  _versione_attesa: z.string().datetime({ offset: true }).optional(),
  // Codice commessa inserito dall'utente (sostituisce il vecchio progressivo G).
  // Permissivo: lettere/cifre/._-/ (accetta anche i vecchi codici G_/S_/C_ per la
  // retrocompatibilità del path di modifica). Obbligo di presenza imposto dalla
  // route POST (create); in modifica (PUT) è opzionale perché il codice è preservato.
  codice: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/, "Codice commessa non valido").max(64).optional(),
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
