import type { Invio, StatoCampagna, StatoInvio } from "./tipi";

/**
 * Presentazione degli stati: una sola tabella, usata da dashboard, scheda e
 * elenchi, così il semaforo ha lo stesso colore dappertutto.
 */
export const STATO_INVIO_UI: Record<
  StatoInvio,
  { etichetta: string; colore: string; sfondo: string; pallino: string }
> = {
  preparata: { etichetta: "Busta preparata", colore: "#92400e", sfondo: "#fef3c7", pallino: "#eab308" },
  da_spedire: { etichetta: "Busta da spedire", colore: "#9a3412", sfondo: "#ffedd5", pallino: "#f97316" },
  consegnata: { etichetta: "Consegnata", colore: "#166534", sfondo: "#dcfce7", pallino: "#22c55e" },
  consegnata_banco: { etichetta: "Consegnata al banco", colore: "#166534", sfondo: "#dcfce7", pallino: "#22c55e" },
  annullata: { etichetta: "Annullata", colore: "#475569", sfondo: "#f1f5f9", pallino: "#94a3b8" },
};

export const STATO_CAMPAGNA_UI: Record<StatoCampagna, { etichetta: string; colore: string; sfondo: string }> = {
  attiva: { etichetta: "Attiva", colore: "#166534", sfondo: "#dcfce7" },
  sospesa: { etichetta: "Sospesa", colore: "#92400e", sfondo: "#fef3c7" },
  terminata: { etichetta: "Terminata", colore: "#475569", sfondo: "#f1f5f9" },
};

/** Gli stati in cui la busta è ancora in lavorazione. */
export const STATI_APERTI: readonly StatoInvio[] = ["preparata", "da_spedire"];

export type AzioneInvio = "modifica" | "consegna" | "banco" | "annulla";

/**
 * Cosa si può fare su un invio, secondo il suo stato. Stesse regole sul client
 * (per mostrare i pulsanti) e sul server (per rifiutare le richieste): una sola
 * funzione, perché due copie divergono.
 *
 * - Una consegna rilevata da un DDT (`fonte_consegna = 'ddt'`, Fase 2) non si
 *   tocca a mano: il DDT è la verità.
 * - Un invio annullato è chiuso.
 */
export function azioniConsentite(invio: Pick<Invio, "stato" | "fonte_consegna">): AzioneInvio[] {
  switch (invio.stato) {
    case "preparata":
    case "da_spedire":
      return ["modifica", "consegna", "banco", "annulla"];
    case "consegnata_banco":
      return ["annulla"];
    case "consegnata":
      return invio.fonte_consegna === "ddt" ? [] : ["annulla"];
    default:
      return [];
  }
}

/** Data di oggi (YYYY-MM-DD) a Roma: a ridosso della mezzanotte l'UTC darebbe il giorno sbagliato. */
export function oggiRoma(adesso: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(adesso);
}

/** "Ordine 1117/2026" oppure null se l'invio non ha un ordine (banco, storico). */
export function etichettaOrdine(invio: Pick<Invio, "ordine_numero" | "ordine_anno">): string | null {
  if (!invio.ordine_numero) return null;
  return invio.ordine_anno ? `${invio.ordine_numero}/${invio.ordine_anno}` : invio.ordine_numero;
}
