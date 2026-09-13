import type { AccessoBi } from "@/lib/prototipo-bi/accesso";
import { registraAccesso } from "@/lib/prototipo-bi/registro";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";

export const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const TIPI_GRAFICO = new Set<TipoGrafico>([
  "linee", "barre", "combo", "torta", "anelli", "areeImpilate", "pareto",
  "bullet", "heatmap", "quadranti", "imbuto", "treemap", "sparkline", "kpi", "tabella",
]);

export function graficoValido(valore: unknown): valore is TipoGrafico {
  return typeof valore === "string" && TIPI_GRAFICO.has(valore as TipoGrafico);
}

export function interoTra(valore: unknown, minimo: number, massimo: number): valore is number {
  return typeof valore === "number" && Number.isInteger(valore) && valore >= minimo && valore <= massimo;
}

export function oggettoJson(valore: unknown): valore is Record<string, unknown> {
  return Boolean(valore) && typeof valore === "object" && !Array.isArray(valore);
}

export async function registraOperazione(
  accesso: AccessoBi,
  esito: "ok" | "errore" | "negato",
  opzioni: { righe?: number; errore?: string } = {}
) {
  await registraAccesso({
    utenteId: accesso.userId,
    livello: accesso.livello,
    perimetro: accesso.perimetro,
    canale: "spec",
    esito,
    ...opzioni,
  });
}
