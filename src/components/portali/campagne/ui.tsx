import type { ReactNode } from "react";
import { STATO_CAMPAGNA_UI, STATO_INVIO_UI } from "@/lib/portali/campagne/stati";
import type { StatoCampagna, StatoInvio } from "@/lib/portali/campagne/tipi";

/** Il semaforo: pallino colorato e nome dello stato, uguale in ogni schermata. */
export function StatoInvioChip({ stato }: { stato: StatoInvio }) {
  const s = STATO_INVIO_UI[stato];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ background: s.sfondo, color: s.colore }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: s.pallino }} aria-hidden />
      {s.etichetta}
    </span>
  );
}

export function StatoCampagnaChip({ stato }: { stato: StatoCampagna }) {
  const s = STATO_CAMPAGNA_UI[stato];
  return (
    <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: s.sfondo, color: s.colore }}>
      {s.etichetta}
    </span>
  );
}

export function Pannello({
  titolo,
  azioni,
  children,
  className = "",
}: {
  titolo?: ReactNode;
  azioni?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-white shadow-sm ${className}`}>
      {titolo || azioni ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="font-tenorite text-sm font-bold text-text">{titolo}</h2>
          {azioni}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function TitoloPagina({ titolo, sottotitolo, azioni }: { titolo: string; sottotitolo?: string; azioni?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-tenorite text-2xl font-bold text-text">{titolo}</h1>
        {sottotitolo ? <p className="mt-1 text-sm text-text-muted">{sottotitolo}</p> : null}
      </div>
      {azioni}
    </div>
  );
}

/** Messaggio d'esito sotto un modulo: rosso per gli errori, verde per le conferme. */
export function Messaggio({ tipo, children }: { tipo: "errore" | "ok"; children: ReactNode }) {
  const stile =
    tipo === "errore"
      ? "border-danger/30 bg-danger/10 text-danger"
      : "border-success/30 bg-success/10 text-success";
  return (
    <p role={tipo === "errore" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${stile}`}>
      {children}
    </p>
  );
}

export function Campo({ etichetta, children, aiuto }: { etichetta: string; children: ReactNode; aiuto?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-text">{etichetta}</span>
      {children}
      {aiuto ? <span className="mt-1 block text-xs text-text-muted">{aiuto}</span> : null}
    </label>
  );
}

export const classeSelect =
  "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
