/**
 * Stati dei documenti del Preventivatore — fonte unica.
 *
 * Nel tempo se ne sono accumulate due generazioni:
 *  - **legacy**, dall'import V2: `pending` / `ordinato` / `rifiutato`
 *  - **workflow**, dalla migration 039: `storico` / `aperta` / `presa_in_carico`
 *    / `completato` / `inviata` / `ordinata` / `fallita`
 *
 * Il guaio è che le due liste si somigliano ma non coincidono (`ordinato` vs
 * `ordinata`), e ogni consumatore si era scritto la propria: l'archivio
 * conosceva solo i legacy e mostrava «In attesa» a tutti, le RPC dashboard
 * contavano `stato = 'ordinato'` e restituivano zero, mentre BI e chat AI
 * usavano già `IN ('ordinato','ordinata')`. Da qui in avanti si passa di qui.
 */

export const STATI_LEGACY = ["pending", "ordinato", "rifiutato"] as const;

/**
 * Stati del workflow (migration 039). Dal 17/09/2026 il portale fa **solo
 * preventivi**: gli unici stati che si possono ancora raggiungere sono
 * `aperta` (bozza) e `completato` (definitivo). Gli altri restano elencati
 * perché esistono nei dati e vanno saputi mostrare, ma nessuna transizione
 * ci porta più — vedi `documenti/[id]/stato/route.ts`.
 */
export const STATI_WORKFLOW = [
  "storico",
  "aperta",
  "presa_in_carico",
  "completato",
  "inviata",
  "ordinata",
  "fallita",
] as const;

/** Gli unici due stati vivi: bozza e definitivo. */
export const STATO_BOZZA = "aperta";
export const STATO_DEFINITIVO = "completato";

export type StatoDocumento =
  | (typeof STATI_LEGACY)[number]
  | (typeof STATI_WORKFLOW)[number];

export const STATI_TUTTI: readonly string[] = [...STATI_LEGACY, ...STATI_WORKFLOW];

/**
 * Raggruppamenti per filtri e conteggi. Ogni gruppo copre **entrambe** le
 * generazioni, così un filtro non sparisce a seconda di come è nato il documento.
 */
export const GRUPPI_STATO = {
  bozza: ["aperta", "presa_in_carico", "pending"],
  definitivo: ["completato"],
  // Restano per i documenti nati dall'import V2, che usa questi stati. Nessuna
  // azione del portale li produce più: il ciclo offerta→esito è stato rimosso
  // perché non è mai entrato in servizio (zero documenti in quegli stati) e
  // perché l'esito vero lo tiene il gestionale.
  ordinato: ["ordinato", "ordinata"],
  rifiutato: ["rifiutato", "fallita"],
  storico: ["storico"],
} as const;

export type GruppoStato = keyof typeof GRUPPI_STATO;

export const STATI_IN_LAVORAZIONE: readonly string[] = [
  ...GRUPPI_STATO.bozza,
  ...GRUPPI_STATO.definitivo,
  "inviata",
];
export const STATI_ORDINATO: readonly string[] = GRUPPI_STATO.ordinato;
export const STATI_RIFIUTATO: readonly string[] = GRUPPI_STATO.rifiutato;

/**
 * Espande il valore di un filtro nella lista di stati da passare a `.in()`.
 * Accetta sia il nome di un gruppo sia un singolo stato, così restano validi i
 * link e i preferiti già in giro. `null` = nessun filtro.
 */
export function statiDaFiltro(valore: string | null | undefined): readonly string[] | null {
  if (!valore || valore === "tutti") return null;
  if (valore in GRUPPI_STATO) return GRUPPI_STATO[valore as GruppoStato];
  if (STATI_TUTTI.includes(valore)) return [valore];
  return null;
}

/** Etichetta e colori del badge, per singolo stato. */
export const BADGE_STATO: Record<StatoDocumento, { label: string; className: string }> = {
  // legacy (import V2)
  pending: { label: "In attesa", className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  ordinato: { label: "Ordinato", className: "bg-green-100 text-green-800 border-green-200" },
  rifiutato: { label: "Rifiutato", className: "bg-red-100 text-red-800 border-red-200" },
  // workflow (migration 039)
  storico: { label: "Archivio storico", className: "bg-slate-100 text-slate-700 border-slate-200" },
  aperta: { label: "Aperta", className: "bg-slate-100 text-slate-700 border-slate-200" },
  presa_in_carico: { label: "Presa in carico", className: "bg-blue-100 text-blue-800 border-blue-200" },
  completato: { label: "Definitivo", className: "bg-violet-100 text-violet-800 border-violet-200" },
  inviata: { label: "Offerta inviata", className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  ordinata: { label: "Ordinata", className: "bg-green-100 text-green-800 border-green-200" },
  fallita: { label: "Fallita", className: "bg-red-100 text-red-800 border-red-200" },
};

/**
 * Badge di uno stato qualsiasi. Uno stato sconosciuto viene mostrato **così
 * com'è**, non travestito da «In attesa»: prima il fallback silenzioso faceva
 * apparire 386 documenti su 386 come in attesa.
 */
export function badgeStato(stato: string): { label: string; className: string } {
  return (
    BADGE_STATO[stato as StatoDocumento] ?? {
      label: stato,
      className: "bg-slate-100 text-slate-600 border-slate-200",
    }
  );
}

/**
 * Stati dai quali un preventivo non si riscrive più: l'offerta è già uscita
 * verso il cliente o la trattativa è chiusa.
 */
export const STATI_NON_MODIFICABILI: readonly string[] = [
  "inviata", "ordinata", "fallita", "ordinato", "rifiutato",
];
