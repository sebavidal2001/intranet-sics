/** Stati documentali ancora validi dopo la rimozione del workflow offerta/esito. */
export const STATI_DOCUMENTO = ["storico", "aperta", "completato"] as const;

export type StatoDocumento = (typeof STATI_DOCUMENTO)[number];

export function isStatoDocumento(valore: string | null | undefined): valore is StatoDocumento {
  return typeof valore === "string" && (STATI_DOCUMENTO as readonly string[]).includes(valore);
}

export const STATO_BOZZA: StatoDocumento = "aperta";
export const STATO_DEFINITIVO: StatoDocumento = "completato";

export const FILTRI_STATO_DOCUMENTO = [
  { value: "tutti", label: "Tutti gli stati" },
  { value: "aperta", label: "Bozze aperte" },
  { value: "completato", label: "Definitivi" },
  { value: "storico", label: "Archivio storico" },
] as const;

export function statiDaFiltro(valore: string | null | undefined): readonly StatoDocumento[] | null {
  if (!valore || valore === "tutti") return null;
  return STATI_DOCUMENTO.includes(valore as StatoDocumento)
    ? [valore as StatoDocumento]
    : null;
}

export const BADGE_STATO: Record<StatoDocumento, { label: string; className: string }> = {
  storico: { label: "Archivio storico", className: "bg-slate-100 text-slate-700 border-slate-200" },
  aperta: { label: "Bozza aperta", className: "bg-slate-100 text-slate-700 border-slate-200" },
  completato: { label: "Definitivo", className: "bg-violet-100 text-violet-800 border-violet-200" },
};

export function badgeStato(stato: string): { label: string; className: string } {
  return BADGE_STATO[stato as StatoDocumento] ?? {
    label: stato,
    className: "bg-slate-100 text-slate-600 border-slate-200",
  };
}

/** Uno storico e consultabile/duplicabile, ma non riscrivibile in place. */
export const STATI_NON_MODIFICABILI: readonly StatoDocumento[] = ["storico"];
