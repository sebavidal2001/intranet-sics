import type { AccessoBi } from "@/lib/prototipo-bi/accesso";
import { registraAccesso } from "@/lib/prototipo-bi/registro";
import { TIPI_GRAFICO, type TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";

export const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Dal catalogo, non ricopiato: la copia a mano era ferma a quindici tipi e
// rifiutava i sei aggiunti il 14/09 (matrice, pendenza, ...).
const TIPI_AMMESSI = new Set<TipoGrafico>(TIPI_GRAFICO);

export function graficoValido(valore: unknown): valore is TipoGrafico {
  return typeof valore === "string" && TIPI_AMMESSI.has(valore as TipoGrafico);
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
