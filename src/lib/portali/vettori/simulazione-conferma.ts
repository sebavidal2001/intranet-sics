import { z } from "zod";

/**
 * Il corpo della conferma di una simulazione (`POST .../vettori/simulazioni`).
 *
 * Sta qui e non nella route perche' deve combaciare con quello che produce
 * `POST .../vettori/simula`: la pagina rimanda indietro gli esiti cosi' come li
 * ha ricevuti. Gli schemi sono stretti di proposito, quindi ogni campo nuovo
 * nella risposta della simulazione va aggiunto anche qui — il test
 * `vettori-simulazione-conferma` fa passare un esito vero per questo schema.
 */
const CONDIZIONI = [
  "bancale",
  "non_sovrapponibile",
  "movimentazione_manuale",
  "oversized",
  "ztl",
  "etichetta_manuale",
  "triangolazione",
  "fuori_provincia",
  "giacenza",
  "assegno",
] as const;

const Gruppo = z.object({
  quantita: z.number().int().min(1).max(999),
  lunghezzaCm: z.number().positive().max(2000),
  larghezzaCm: z.number().positive().max(2000),
  altezzaCm: z.number().positive().max(2000),
  pesoRealeKg: z.number().positive().max(100_000).nullable().optional(),
}).strict();

const VoceCalcolo = z.object({
  codice: z.string(),
  descrizione: z.string(),
  importo: z.number().finite(),
}).strict();

const Costo = z.object({
  pesoReale: z.number().min(0),
  pesoVolumetrico: z.number().min(0),
  pesoTassabile: z.number().min(0),
  pesoApplicato: z.enum(["reale", "volumetrico", "minimo"]),
  nolo: z.number().min(0),
  fasciaDescrizione: z.string(),
  supplementi: z.array(VoceCalcolo),
  imponibileNolo: z.number().min(0),
  adeguamento: z.number().min(0),
  carburante: z.number().min(0),
  fuoriBase: z.number().min(0),
  totale: z.number().min(0),
  avvertenze: z.array(z.string()),
}).strict();

const Riaddebito = z.object({
  importo: z.number().min(0).nullable(),
  pesoUsato: z.number().min(0),
  basePeso: z.enum(["reale", "tassabile"]),
  regola: z.string(),
  avvertenza: z.string().nullable(),
}).strict();

const Esito = z.object({
  vettoreId: z.string().uuid(),
  vettoreCodice: z.string().min(1),
  vettoreNome: z.string().min(1),
  disponibile: z.boolean(),
  motivoIndisponibilita: z.string().optional(),
  // `id` lo aggiunge `descriviListino`. Senza questa riga lo schema stretto
  // rifiutava ogni simulazione con almeno un vettore disponibile: la conferma
  // non era mai riuscita, nemmeno una volta, e l'operatore leggeva solo
  // «Dati non validi».
  listino: z.object({
    id: z.string().uuid().optional(),
    etichetta: z.string(),
    validoDal: z.string().date(),
    validoAl: z.string().date().nullable(),
  }).strict().nullable().optional(),
  calcolo: Costo.optional(),
  differenzaDalMigliore: z.number().finite().optional(),
  riaddebito: Riaddebito.optional(),
  margine: z.number().finite().nullable().optional(),
}).strict();

export const SimulazioneConfermata = z.object({
  direzione: z.enum(["entrata", "uscita"]).default("uscita"),
  cap: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  provincia: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
  fonteProvincia: z.enum(["cap", "prefisso", "manuale"]).nullable().optional(),
  controparteCodice: z.string().trim().min(1).max(100).nullable().optional(),
  colli: z.number().int().min(1).max(999),
  pesoKg: z.number().positive().max(100_000),
  gruppi: z.array(Gruppo).max(999).default([]),
  lunghezzaCm: z.number().positive().max(2000).nullable().optional(),
  larghezzaCm: z.number().positive().max(2000).nullable().optional(),
  altezzaCm: z.number().positive().max(2000).nullable().optional(),
  data: z.string().date(),
  condizioni: z.array(z.enum(CONDIZIONI)).max(CONDIZIONI.length).default([]),
  vettoreSceltoId: z.string().uuid(),
  costoPrevisto: z.number().min(0),
  riaddebitoPrevisto: z.number().min(0).nullable(),
  esiti: z.array(Esito).min(1).max(100),
}).strict();

export const CorpoConfermaSimulazione = z.object({
  simulazione: SimulazioneConfermata,
  bolla: z.object({
    numeroRiferimento: z.string().trim().min(1).max(200).nullable(),
    dataDocumento: z.string().date(),
    controparteNome: z.string().trim().min(1).max(500),
    controparteCodice: z.string().trim().min(1).max(100).nullable(),
  }).strict(),
}).strict();

export type SimulazioneConfermataInput = z.infer<typeof SimulazioneConfermata>;
