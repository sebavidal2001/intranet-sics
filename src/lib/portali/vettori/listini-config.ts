import { z } from "zod";

export const FasciaConfig = z.object({
  zona_id: z.string().uuid(), peso_da: z.number().finite().min(0),
  peso_a: z.number().finite().positive().nullable(),
  importo: z.number().finite().min(0), tipo: z.enum(["fisso", "quintale"]),
  scatto_kg: z.number().finite().positive().nullable(),
  scatto_importo: z.number().finite().min(0).nullable(),
}).refine((f) => f.peso_a === null || f.peso_a > f.peso_da, "La soglia finale deve superare quella iniziale")
  .refine((f) => (f.scatto_kg === null) === (f.scatto_importo === null), "Compilare entrambi i valori dello scatto")
  .refine((f) => f.scatto_kg === null || (f.peso_a === null && f.tipo === "fisso"), "Gli scatti sono ammessi solo sulla fascia finale fissa");

export const NuovoListino = z.object({
  listino_id: z.string().uuid(),
  etichetta: z.string().trim().min(1).max(150),
  valido_dal: z.string().date(),
  fasce: z.array(FasciaConfig).min(1).max(300),
  supplementi: z.array(z.object({ codice: z.string().min(1), valore: z.number().finite().min(0) })).max(100),
}).superRefine((b, ctx) => {
  for (const zona of new Set(b.fasce.map((f) => f.zona_id))) {
    const righe = b.fasce.filter((f) => f.zona_id === zona).sort((a, c) => a.peso_da - c.peso_da);
    if (righe[0].peso_da !== 0 || righe.some((f, i) => i > 0 && righe[i - 1].peso_a !== f.peso_da)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fasce"], message: "Le fasce devono partire da zero ed essere consecutive, senza buchi o sovrapposizioni." });
    }
  }
  if (new Set(b.supplementi.map((s) => s.codice)).size !== b.supplementi.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["supplementi"], message: "Supplementi duplicati." });
});
export type FasciaModificabile = z.infer<typeof FasciaConfig>;

/**
 * Un supplemento nuovo, con il periodo in cui vale. La data di inizio è
 * obbligatoria: una voce senza inizio varrebbe anche per le spedizioni già
 * controllate, e i mesi chiusi si muoverebbero.
 */
export const NuovoSupplemento = z.object({
  listino_id: z.string().uuid(),
  nome: z.string().trim().min(1, "Indicare il nome del supplemento").max(150),
  tipo_calcolo: z.enum(["fisso_spedizione", "per_kg", "per_collo", "percentuale_nolo"]),
  valore: z.number().finite().min(0, "Il valore non può essere negativo"),
  base_nolo: z.boolean().default(false),
  condizione: z.string().trim().min(1).max(50).default("sempre"),
  valido_dal: z.string().date("Indicare da quando vale"),
  valido_al: z.string().date().nullable().optional(),
}).refine((s) => !s.valido_al || s.valido_al >= s.valido_dal, {
  path: ["valido_al"], message: "La data finale precede quella iniziale",
});
export type NuovoSupplementoInput = z.infer<typeof NuovoSupplemento>;

/** Codice stabile ricavato dal nome: «Diritto fisso» → `diritto_fisso`. */
export function codiceSupplemento(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}
