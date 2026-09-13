import type { SupabaseClient } from "@supabase/supabase-js";
import type { BollaGestionale, Direzione, SpedizioneLogica } from "./abbinamento";
import type { CampiBollaForzati, CampoBollaForzabile } from "./tipi";

export const CAMPI_BOLLA_FORZABILI: readonly [
  "direzione",
  "numero_riferimento",
  "data_documento",
  "controparte_nome",
  "vettore_id",
  "colli_bolla",
  "peso_bolla",
];
export const CAMPI_BOLLA_GESTIONALE: readonly (keyof BollaGestionale)[];
export const SELEZIONE_BOLLA_GESTIONALE: string;

type ValoreCampo = string | number | boolean | null;
type ValoriForzabili = Record<CampoBollaForzabile, ValoreCampo>;

export function normalizzaRiferimento(
  valore: string | null | undefined
): string | null;
export function direzioneDi(bolla: BollaGestionale): Direzione | null;
export function aNostroCarico(
  direzione: Direzione,
  portoCodice: string | null
): boolean | null;
export function raggruppaInSpedizioni(
  bolle: BollaGestionale[]
): SpedizioneLogica[];
export function campiForzatiDaDb(value: unknown): CampiBollaForzati;
export function campiForzatiPerDb(
  value: CampiBollaForzati
): Record<string, unknown>;
export function pianificaFusioneCampi(
  attuali: ValoriForzabili,
  gestionali: ValoriForzabili,
  forzati: CampiBollaForzati,
  congelata: boolean
): {
  aggiornamenti: Partial<ValoriForzabili>;
  differenze: Record<string, { spedizione: ValoreCampo; gestionale: ValoreCampo }>;
};
export function documentiGestionaliDelRun(
  righe: ReadonlyArray<Record<string, unknown>>
): BollaGestionale[];
export function sincronizzaBolleGestionali(
  admin: SupabaseClient,
  bolle: BollaGestionale[]
): Promise<void>;
export function sincronizzaSpedizioniGestionali(
  admin: SupabaseClient,
  spedizioni: SpedizioneLogica[],
  dettagli?: Map<number, {
    codiceProfilo: string | null;
    tipoRegistro: string | null;
    numeroProgressivo: string | null;
    numeroDocumento: string | null;
  }>
): Promise<void>;
