import { z } from "zod";

/**
 * Validazione delle richieste del Portale Campagne.
 *
 * Si limitano dimensioni e forma dei dati inseriti da una persona (referente,
 * ordine, note). I campi che il client calcola da sé non si irrigidiscono: un
 * client appena rilasciato non deve rompersi contro uno schema più stretto.
 */

const testo = (max: number) => z.string().trim().max(max);
const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida (AAAA-MM-GG)");

const codiceCliente = z.string().trim().min(1).max(30);

/** Numero ordine di Impresa: cifre e, per prudenza, lettere e separatori comuni. */
export const numeroOrdine = z
  .string()
  .trim()
  .min(1, "Inserisci il numero d'ordine")
  .max(20)
  .regex(/^[0-9A-Za-z./-]+$/, "Il numero d'ordine contiene caratteri non validi");

export const anno = z.number().int().min(2000).max(2100);

export const referente = z
  .string()
  .trim()
  .min(2, "Inserisci il nome del referente")
  .max(120);

// ─── Invii ─────────────────────────────────────────────────────────────────
export const AssegnaInvioBody = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("ordine"),
    codice_cliente: codiceCliente,
    campagna_id: uuid,
    referente,
    ordine_numero: numeroOrdine,
    ordine_anno: anno,
    note: testo(500).nullish(),
  }),
  z.object({
    tipo: z.literal("banco"),
    codice_cliente: codiceCliente,
    campagna_id: uuid,
    // Al banco il referente non e' obbligatorio: spesso e' chi passa a ritirare.
    referente: testo(120).nullish(),
    data_consegna: dataIso.nullish(),
    note: testo(500).nullish(),
  }),
]);
export type AssegnaInvioInput = z.infer<typeof AssegnaInvioBody>;

export const AggiornaInvioBody = z.discriminatedUnion("azione", [
  z.object({
    azione: z.literal("modifica"),
    referente: referente.optional(),
    ordine_numero: numeroOrdine.optional(),
    ordine_anno: anno.optional(),
    note: testo(500).nullish(),
  }),
  z.object({ azione: z.literal("consegna"), data_consegna: dataIso }),
  z.object({ azione: z.literal("banco"), data_consegna: dataIso.nullish() }),
  z.object({ azione: z.literal("annulla"), motivo: z.string().trim().min(3, "Indica il motivo").max(300) }),
]);
export type AggiornaInvioInput = z.infer<typeof AggiornaInvioBody>;

/** Un parametro che puo' comparire una volta o piu' volte nell'indirizzo (`?campagna_id=a&campagna_id=b`). */
const unoOPiu = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : [v]), z.array(schema).max(50).optional());

export const FiltroInvii = z.object({
  stato: z.enum(["preparata", "da_spedire", "consegnata", "consegnata_banco", "annullata"]).optional(),
  // Piu' campagne insieme: l'invio e' di una di quelle scelte.
  campagna_id: unoOPiu(uuid),
  // Chi ha seguito la campagna (l'utente che ha assegnato l'invio).
  utente_id: uuid.optional(),
  q: testo(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * La vista «per cliente» della pagina Invii: i clienti che hanno ricevuto almeno una
 * delle campagne scelte (nessuna scelta = almeno una qualsiasi).
 */
export const FiltroClientiCampagne = z.object({
  campagna_id: unoOPiu(uuid),
  q: testo(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FiltroClientiCampagneInput = z.infer<typeof FiltroClientiCampagne>;

// ─── Campagne (admin) ──────────────────────────────────────────────────────
const parole = z.array(z.string().trim().min(1).max(60)).max(10);

export const CreaCampagnaBody = z.object({
  codice: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "Il codice può contenere solo lettere, numeri, _ e -"),
  nome: z.string().trim().min(1, "Inserisci il titolo").max(120),
  note: testo(1000).nullish(),
  articolo_codice: z.string().trim().min(1, "Inserisci il codice articolo").max(60),
  testo_riconoscimento: parole.default([]),
  riferimento: testo(300).nullish(),
  stato: z.enum(["attiva", "sospesa"]).default("sospesa"),
  // Il pubblico della campagna. Assente = lo standard.
  pubblico_id: uuid.optional(),
  // Copia subito nei destinatari i clienti del pubblico (di default si').
  applica_pubblico: z.boolean().default(true),
});
export type CreaCampagnaInput = z.infer<typeof CreaCampagnaBody>;

export const AggiornaCampagnaBody = z
  .object({
    nome: z.string().trim().min(1).max(120),
    note: testo(1000).nullable(),
    articolo_codice: z.string().trim().min(1).max(60),
    testo_riconoscimento: parole,
    riferimento: testo(300).nullable(),
    stato: z.enum(["attiva", "sospesa", "terminata"]),
    // Cambiare pubblico non toglie i destinatari che la campagna ha già.
    pubblico_id: uuid,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nessuna modifica");
export type AggiornaCampagnaInput = z.infer<typeof AggiornaCampagnaBody>;

const elencoCodici = z.array(codiceCliente).min(1).max(5000);
const elencoCategorie = z.array(z.string().trim().min(1).max(120)).min(1).max(100);

export const DestinatariBody = z.discriminatedUnion("azione", [
  z.object({ azione: z.literal("applica_pubblico") }),
  z.object({ azione: z.literal("aggiungi"), codici: elencoCodici }),
  z.object({ azione: z.literal("rimuovi"), codici: elencoCodici }),
  z.object({ azione: z.literal("aggiungi_categorie"), categorie: elencoCategorie }),
  z.object({ azione: z.literal("rimuovi_categorie"), categorie: elencoCategorie }),
]);
export type DestinatariInput = z.infer<typeof DestinatariBody>;

const regolaPubblico = {
  agenti: z.array(z.string().trim().min(1).max(80)).max(20),
  categorie_commerciali: z.array(z.string().trim().min(1).max(40)).max(10),
  // `[]` significa «tutte le categorie»: per questo e' obbligatoria, mai «assente = non si tocca».
  categorie_attivita: z.array(z.string().trim().min(1).max(120)).max(200),
  clienti_extra: z.array(codiceCliente).max(5000),
};
const nomePubblico = z.string().trim().min(1, "Dai un nome al pubblico").max(80);

/** Salva un pubblico: nome, descrizione e regola. */
export const PubblicoBody = z.object({
  nome: nomePubblico,
  descrizione: testo(300).nullish(),
  ...regolaPubblico,
});
export type PubblicoInput = z.infer<typeof PubblicoBody>;

/** Crea un pubblico, vuoto oppure copiando la regola di un altro (di solito lo standard). */
export const CreaPubblicoBody = z.object({
  nome: nomePubblico,
  descrizione: testo(300).nullish(),
  copia_da: uuid.optional(),
});
export type CreaPubblicoInput = z.infer<typeof CreaPubblicoBody>;

// ─── Anomalie ──────────────────────────────────────────────────────────────
export const FiltroAnomalieQuery = z.object({
  stato: z.enum(["aperta", "risolta", "ignorata"]).optional(),
  tipo: z
    .enum([
      "ordine_non_trovato",
      "riga_mancante",
      "campagna_incoerente",
      "riga_senza_campagna",
      "evasa_senza_ddt",
      "documentazione_senza_busta",
      "ordine_invertito",
    ])
    .optional(),
  codice_cliente: codiceCliente.optional(),
});

export const AggiornaAnomaliaBody = z.discriminatedUnion("azione", [
  // Lasciare un'anomalia com'e' richiede di dire perche': resta traccia di chi l'ha deciso.
  z.object({ azione: z.literal("ignora"), nota: z.string().trim().min(3, "Scrivi il motivo").max(300) }),
  z.object({ azione: z.literal("applica_scambio") }),
]);
export type AggiornaAnomaliaInput = z.infer<typeof AggiornaAnomaliaBody>;
