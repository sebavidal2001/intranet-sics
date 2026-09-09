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
