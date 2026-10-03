import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { STATO_CAMPAGNA_UI, STATO_INVIO_UI } from "@/lib/portali/campagne/stati";
import type { StatoCampagna, StatoInvio } from "@/lib/portali/campagne/tipi";

type Icona = LucideIcon;

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

/**
 * La scheda bianca su cui poggia ogni sezione. Angoli morbidi, un'ombra leggera e
 * un'intestazione con filo sottile: stessa grammatica in tutto il portale.
 */
export function Pannello({
  titolo,
  descrizione,
  icona: Icona,
  azioni,
  children,
  className = "",
  senzaPadding = false,
}: {
  titolo?: ReactNode;
  descrizione?: ReactNode;
  icona?: Icona;
  azioni?: ReactNode;
  children: ReactNode;
  className?: string;
  senzaPadding?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,32,0.04),0_4px_16px_rgba(15,23,32,0.04)] ${className}`}>
      {titolo || azioni ? (
        <header className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-b from-white to-bg-page/60 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            {Icona ? (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icona className="h-4 w-4" aria-hidden />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="font-tenorite text-sm font-bold text-text">{titolo}</h2>
              {descrizione ? <p className="mt-0.5 text-xs text-text-muted">{descrizione}</p> : null}
            </div>
          </div>
          {azioni}
        </header>
      ) : null}
      <div className={senzaPadding ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function TitoloPagina({
  titolo,
  sottotitolo,
  azioni,
  icona: Icona,
}: {
  titolo: string;
  sottotitolo?: string;
  azioni?: ReactNode;
  icona?: Icona;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3.5">
        {Icona ? (
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-dark text-white shadow-sm">
            <Icona className="h-5 w-5" aria-hidden />
          </span>
        ) : null}
        <div>
          <h1 className="font-tenorite text-2xl font-bold tracking-tight text-text">{titolo}</h1>
          {sottotitolo ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{sottotitolo}</p> : null}
        </div>
      </div>
      {azioni}
    </div>
  );
}

/** Una tessera di numeri: l'accento colorato dice cos'e' prima ancora di leggere. */
export function Tessera({
  numero,
  testo,
  colore,
  icona: Icona,
}: {
  numero: string;
  testo: string;
  colore: string;
  icona?: Icona;
}) {
  return (
    <div
      className="group relative h-full overflow-hidden rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,32,0.04)] transition-all duration-150 group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_24px_rgba(0,161,190,0.12)]"
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: colore }} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <span className="font-tenorite text-3xl font-bold leading-none text-text">{numero}</span>
        {Icona ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${colore}1f`, color: colore }}>
            <Icona className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-text-muted">{testo}</p>
    </div>
  );
}

/** Lo stato «non c'e' niente»: una frase che dice cosa fare, non un buco bianco. */
export function Vuoto({ titolo, testo, icona: Icona = Inbox }: { titolo: string; testo?: string; icona?: Icona }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-page text-text-muted">
        <Icona className="h-6 w-6" aria-hidden />
      </span>
      <p className="font-tenorite text-sm font-bold text-text">{titolo}</p>
      {testo ? <p className="max-w-sm text-sm text-text-muted">{testo}</p> : null}
    </div>
  );
}

/** L'intestazione numerata di un passo di una procedura guidata. */
export function Passo({ numero, titolo, children }: { numero: number; titolo: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-tenorite text-sm font-bold text-white">
        {numero}
      </span>
      <div>
        <h3 className="font-tenorite text-base font-bold text-text">{titolo}</h3>
        {children ? <div className="mt-0.5 text-sm leading-relaxed text-text-muted">{children}</div> : null}
      </div>
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

/** Classi comuni delle tabelle: intestazione discreta, righe che si evidenziano al passaggio. */
export const classeTh = "py-2.5 pr-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted";
export const classeRiga = "transition-colors hover:bg-bg-page/70";
