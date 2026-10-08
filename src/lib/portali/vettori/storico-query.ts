import { z } from "zod";
import type { DirezioneStorico, TipoAbbinamento } from "./tipi";

const Abbinamento = z.enum(["numero", "assistito", "manuale", "nessuno"]);

const QuerySpedizioni = z.object({
  direzione: z.enum(["entrata", "uscita"]).optional(),
  abbinamenti: z.preprocess((valore) => {
    const parti = Array.isArray(valore) ? valore : typeof valore === "string" ? [valore] : [];
    return parti.flatMap((parte) => String(parte).split(",")).map((parte) => parte.trim()).filter(Boolean);
  }, z.array(Abbinamento).max(4)).optional(),
});

export interface FiltriInizialiSpedizioni {
  direzione: DirezioneStorico;
  abbinamenti: TipoAbbinamento[];
}

/** Legge solo i filtri condivisibili; valori non validi ripristinano i default. */
export function leggiFiltriInizialiSpedizioni(
  query: Record<string, string | string[] | undefined>
): FiltriInizialiSpedizioni {
  const parsed = QuerySpedizioni.safeParse(query);
  if (!parsed.success) return { direzione: "uscita", abbinamenti: [] };
  return {
    direzione: parsed.data.direzione ?? "uscita",
    abbinamenti: parsed.data.abbinamenti ?? [],
  };
}
