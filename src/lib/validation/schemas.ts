import { z } from "zod";

// ─── UTENTE BASE ──────────────────────────────────────────────────────────────
// Campi condivisi tra creazione e modifica utente.
// Ruolo è stringa libera per supportare i ruoli dinamici da ruoli_config.
export const UtenteBaseSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  cognome: z.string().min(1, "Cognome obbligatorio"),
  email: z.string().email("Email non valida"),
  ruolo: z.string().min(1, "Ruolo obbligatorio"),
  reparto: z.string().optional(),
  responsabile_id: z.string().uuid().optional().nullable(),
  stato: z.enum(["attivo", "inattivo"]),
});

export type UtenteBase = z.infer<typeof UtenteBaseSchema>;

// ─── PASSWORD ─────────────────────────────────────────────────────────────────
export const PasswordSchema = z.object({
  password: z.string().min(6, "Password minimo 6 caratteri"),
});

export type Password = z.infer<typeof PasswordSchema>;

// ─── SCALA VALUTAZIONE ────────────────────────────────────────────────────────
export const ScalaSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  min: z.coerce.number().int().min(1, "Min >= 1"),
  max: z.coerce.number().int().max(100, "Max <= 100"),
});

export type Scala = z.infer<typeof ScalaSchema>;

// ─── PARAMETRO RADAR ──────────────────────────────────────────────────────────
export const ParametroRadarSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  descrizione: z.string().optional(),
  colore: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colore non valido (formato #RRGGBB)"),
  ordine: z.coerce.number().int().min(0),
});

export type ParametroRadar = z.infer<typeof ParametroRadarSchema>;

// ─── SESSIONE VALUTAZIONE ─────────────────────────────────────────────────────
export const SessioneSchema = z.object({
  anno: z.coerce.number().int().min(2020).max(2050),
  scala_id: z.string().uuid("Seleziona una scala"),
});

export type Sessione = z.infer<typeof SessioneSchema>;

