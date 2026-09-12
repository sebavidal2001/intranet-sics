/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Guardia di sicurezza: impedisce al prototipo di funzionare in un ambiente
 * di produzione. Vedere `prototipo-bi/NON-IN-PRODUZIONE.md`.
 *
 * Decisione esplicita di Sebastiano del 28/08/2026: questo codice resta in
 * locale finché il preventivo non viene approvato. La variabile di sblocco
 * NON deve essere creata sulla VM.
 */

export const ETICHETTA_PROTOTIPO = "PROTOTIPO — NON IN PRODUZIONE";

/** Vero se siamo in un ambiente dove il prototipo può girare. */
export function prototipoConsentito(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.PROTO_BI_CONSENTI_PRODUZIONE === "1";
}

/**
 * Da chiamare all'inizio di ogni route handler e di ogni pagina del prototipo.
 * Solleva se l'ambiente non è consentito.
 */
export function assertPrototipoConsentito(): void {
  if (prototipoConsentito()) return;
  throw new Error(
    "Prototipo BI non disponibile in produzione. " +
      "Questo modulo è in attesa di approvazione e non deve essere attivato " +
      "senza indicazione esplicita di Sebastiano."
  );
}

/** Risposta JSON standard quando la guardia blocca una API. */
export function rispostaBloccata() {
  return new Response(
    JSON.stringify({
      error: "Prototipo non disponibile in questo ambiente",
      dettaglio: "Modulo in attesa di approvazione: non attivo in produzione.",
    }),
    { status: 503, headers: { "content-type": "application/json" } }
  );
}
